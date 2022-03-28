import got from 'got';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import 'dotenv/config';
import { PS_RoutingRow, PS_TrackingRow, PS_WorkOrder, sequelize } from './db.js';

// Base URL
const baseUrl = 'https://machinesciences.adionsystems.com';

// Create a cookie jar to hold our authentication cookie
const cookieJar = new CookieJar();

// Check for existing authentication cookie
if (process.env.COOKIE !== undefined)
    cookieJar.setCookieSync(process.env.COOKIE, 'https://machinesciences.adionsystems.com/procnc/');

// Run PSBot
activateBot();

async function activateBot() {
    console.log('Checking logged in status...');
    // Check if we are logged in
    let loggedIn = await isAuthenticated();
    console.log(`Authenticated status: ${loggedIn}`);

    // If not logged in, attemp to log in
    // I am using cookies in place of plaintext auth at the moment!
    // If for some reason the cookie becomes invalid, it will try to log in via username and password
    if (!loggedIn) {
        if (process.env.USERNAME === undefined || process.env.PASSWORD === undefined)
            throw Error('.env missing login credentials');

        console.log('Logging in...');
        await logIn();

        loggedIn = await isAuthenticated();

        // Something is wrong with our login details
        if (!loggedIn)
            throw Error('Could not log in!');
        
        console.log(`Successfully logged in`);
    }

    // Init database
    // Do not set 'force' to true, unless you want to rebuild the database from scratch
    console.log('Syncing psql database');
    await sequelize.sync({ force: false });

    // Build an update list by querying ProShop
    console.log('Commence the scrape');
    let updateList = await buildUpdateList();

    // Execute update list by navigating to all matched work orders
    console.log(`Update list length: ${updateList.length}`);
    await executeUpdateList(updateList);
}

async function executeUpdateList(list: string[]) {
    for (let wo of list)
        await fetchWorkOrder(wo);
}

function fetchWorkOrder(index: string): Promise<void> {
    return new Promise(resolve => {
        got(`${baseUrl}/procnc/workorders/${index}`, {cookieJar})
        .then((res: any) => res.body).then(async (html) => {
            let $ = cheerio.load(html);
            console.log($('title').text());

            let wo_index = $('#horizontalMainAtts_workOrderNumber_value').text();
            let wo_status = statusToEnum($('#horizontalMainAtts_status_value').text());
            let wo_orderQuantity = Number($('#horizontalMainAtts_quantityordered_value').text());

            // Delete existing entry if one can be found
            await PS_WorkOrder.destroy({ where: { index: wo_index } });

            // Create a fresh entry
            const wo = await PS_WorkOrder.create({
                index: wo_index,
                status: wo_status,
                orderQuantity: wo_orderQuantity
            });

            await parseRoutingTable(wo, $);
            await parseTrackingTable(wo);

            resolve();
        });
    });
}

async function parseRoutingTable(wo: PS_WorkOrder, $: cheerio.Root) {
    let rows = $('table.proshop-table').eq(5).find('tbody > tr');

    for (let row of rows) {
        let rowComplete: boolean = $(row).find("td:nth-of-type(10) span").hasClass("glyphicon-ok");
        let time: string | undefined = $(row).find("td:nth-of-type(10) span").attr("title");
        let rowCompleteDate: Date | null = null;

        if (rowComplete && time !== undefined) {
            let hour: number = Number(time.split(":")[1].slice(-2));

            // Convert 12hr to 24hr
            if (time.split(";")[1].slice(-2) === "PM" && hour !== 12)
                hour += 12;
            if (time.split(";")[1].slice(-2) === "AM" && hour === 12)
                hour -= 12;

            rowCompleteDate = new Date(
                Number(time.split("/")[2].slice(0, 4)),
                Number(time.split("/")[0].slice(-2)) - 1,
                Number(time.split("/")[1]), 
                Number(time.split(":")[1].slice(-2)),
                Number(time.split(":")[2]), 
                Number(time.split(":")[3].slice(0, 2))
            );
        }

        let createOrUpdateData = {
            op: $(row).find('td:first-of-type > a').text(),
            opDesc: $(row).find("td:nth-of-type(2)").text(),
            resource: $(row).find("td:nth-of-type(3)").text(),
            completeTotal: Number($(row).find('td:nth-child(7)').text()),
            completeDate: rowCompleteDate,
            workOrderId: wo.id
        }

        await PS_RoutingRow.create(createOrUpdateData);
    }
}

function parseTrackingTable(wo: PS_WorkOrder): Promise<void> {
    return new Promise(async resolve => {
        await got(`${baseUrl}/procnc/procncAdmin/viewTimeTracking$viewType=byworkorder&currentYearWos=${wo.index}&userId=all`, {cookieJar})
        .then(res => res.body).then(async html => {
            const $ = cheerio.load(html);

            let rows = $('#dataTable > tbody > tr');

            for (let row of rows) {
                if ($(row).find('td:nth-child(3)').text().trim() !== 'Running')
                    continue;

                let createOrUpdateData = {
                    dateStarted: parseTrackingDate($(row).find('td:nth-child(4) > span').text()),
                    dateEnded: parseTrackingDate($(row).find('td:nth-child(5) > span').text()),
                    op: $(row).find('td:nth-child(7)').text().trim(),
                    resource: $(row).find('td:nth-child(8)').text().trim(),
                    quantityStart: 0,
                    quantityEnd: 0,
                    quantityTotal: Number($(row).find('td:nth-child(13)').text()),
                    workOrderId: wo.id
                }

                // Sometimes quantities are left blank, so we check for this
                // and keep in mind default values are zero
                let quantities = $(row).find('td:nth-child(12) > span').text();

                if (quantities !== '' && quantities.includes('/')) {
                    createOrUpdateData.quantityStart = Number($(row).find('td:nth-child(12) > span').text().split('/')[0]);
                    createOrUpdateData.quantityEnd   = Number($(row).find('td:nth-child(12) > span').text().split('/')[1]);
                } else {
                    createOrUpdateData.quantityStart = Number($(row).find('td:nth-child(12) > span').text());
                    createOrUpdateData.quantityEnd   = Number($(row).find('td:nth-child(12) > span').text());
                }

                await PS_TrackingRow.create(createOrUpdateData);
            }

            resolve();
        });
    });
}

function buildUpdateList(): Promise<string[]> {
    return new Promise(async resolve => {
        // Get all existing records in db
        let dbentries = await PS_WorkOrder.findAll({ attributes: ['index', 'status'] });

        // Init our update list and our custom ProShop queries
        let list: string[] = [];
        let queries: string[] = ['query55', 'query56', 'query59', 'query57', 'query58'];

        // Add all db entries that are not invoiced
        list.push(...dbentries.filter(e => e.status !== PS_WorkOrder_Status.INVOICED).map(e => e.index));

        for (let q of queries)
            await got(`${baseUrl}/procnc/workorders/searchresults$queryScope=global&queryName=${q}&pName=workorders`, {cookieJar})
            .then(res => res.body).then(html => {
                console.log(`Looking at query ${q}`);
                let $ = cheerio.load(html);
                let tableRows = $('#dataTable tbody > tr');

                for (let row of tableRows) {
                    let wo_index = $(row).find('td:nth-child(1) > a:nth-child(1)').text();
                    let wo_status = statusToEnum($(row).find('td:nth-child(10)').text());

                    if (!dbentries.map(e => e.index).includes(wo_index))
                        list.push(wo_index);
                }
            });

        resolve(list);
    });
}

function isAuthenticated(): Promise<boolean> {
    return new Promise(resolve => {
        got('https://machinesciences.adionsystems.com/procnc/', {cookieJar}).then(res => res.body).then(html => {
            let $ = cheerio.load(html);
            if ($('title').text() === 'ProShop Login') {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function logIn(): Promise<void> {
    return new Promise(resolve => {
        got.post('https://machinesciences.adionsystems.com/home/member/login', {
            form: {
                mailAddress: process.env.USERNAME,
                password: process.env.PASSWORD,
                rememberLogin: true
            },
            cookieJar
        }).then(() => {
            console.log(cookieJar.getCookiesSync('https://machinesciences.adionsystems.com/procnc/'));
            resolve();
        });
    });
}

enum PS_WorkOrder_Status { ACTIVE = 0, CANCELED, COMPLETE, INVOICED, MANUFACTURING_COMPLETE, ON_HOLD, SHIPPED, UNKNOWN }

function statusToEnum(status: string): PS_WorkOrder_Status {
    let statusCleaned: string = status.trim().toLowerCase();

    if (statusCleaned === 'active')
        return PS_WorkOrder_Status.ACTIVE;
    else if (statusCleaned === 'canceled')
        return PS_WorkOrder_Status.CANCELED;
    else if (statusCleaned === 'complete')
        return PS_WorkOrder_Status.COMPLETE;
    else if (statusCleaned === 'invoiced')
        return PS_WorkOrder_Status.INVOICED;
    else if (statusCleaned === 'manufacturing complete')
        return PS_WorkOrder_Status.MANUFACTURING_COMPLETE;
    else if (statusCleaned === 'on hold')
        return PS_WorkOrder_Status.ON_HOLD;
    else if (statusCleaned === 'shipped')
        return PS_WorkOrder_Status.SHIPPED;
    else
        return PS_WorkOrder_Status.UNKNOWN;
}

function parseTrackingDate(date: string): Date | undefined {
    if (date === '') return undefined;

    let month: number = parseInt(date.split("-")[1]);
    let day: number = parseInt(date.split("T")[0].slice(-2));
    let year: number = parseInt(date.slice(0, 4));
    let hour: number = parseInt(date.split("T")[1].slice(0, 2));
    let minute: number = parseInt(date.split("T")[1].slice(2, 4));
    let second: number = parseInt(date.split("T")[1].slice(4, 6));

    // We take 8 or 7 hours away to convert from UTC to PST
    // Note that the embedded date is in UTC
    // Also, we need to account for DST...
    let temp: Date = new Date(year, month - 1, day, hour, minute, second);
    temp.setHours(isDST(temp) ? temp.getHours() - 7 : temp.getHours() - 8);

    return temp;
}

function isDST(date: Date): boolean {
    let jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    let jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) !== date.getTimezoneOffset();    
}