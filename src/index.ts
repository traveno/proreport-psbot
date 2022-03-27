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
    console.log('Syncing psql database');
    await sequelize.sync({ force: false });

    // Begin navigating the website
    console.log('Commence the scrape');

    let updateList = await buildUpdateList();

    console.log(`Update list length: ${updateList.length}`);

    //await executeUpdateList(updateList.slice(100, 105));
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
            const dbentry = await PS_WorkOrder.findOne({ where: { index: wo_index } });

            if (dbentry !== null) {
                await PS_WorkOrder.update({
                    status: wo_status,
                    orderQuantity: wo_orderQuantity
                }, { where: { id: dbentry.id } });
                parseRoutingTable(dbentry, $);
                parseTrackingTable(dbentry);

                // We're done
                resolve();
                return;
            }

            // Create a fresh entry
            await PS_WorkOrder.create({
                index: wo_index,
                status: wo_status,
                orderQuantity: wo_orderQuantity
            }).then(async instance => {
                instance.save();
                parseRoutingTable(instance, $);
                await parseTrackingTable(instance);
            });

            resolve();
        });
    });
}

function parseRoutingTable(wo: PS_WorkOrder, $: cheerio.Root) {
    // Delete existing rows in database
    PS_RoutingRow.destroy({ where: { workOrderId: wo.id } });


    let rows = $('table.proshop-table').eq(5).find('tbody > tr');
    rows.each(async function (this: cheerio.Cheerio) {
        let rowComplete: boolean = $(this).find("td:nth-of-type(10) span").hasClass("glyphicon-ok");
        let temp: string | undefined = $(this).find("td:nth-of-type(10) span").attr("title");
        let rowCompleteDate: Date | null = null;

        if (rowComplete && temp !== undefined) {
            let month: number = parseInt(temp.split("/")[0].slice(-2));
            let day: number = parseInt(temp.split("/")[1]);
            let year: number = parseInt(temp.split("/")[2].slice(0, 4));
            let hour: number = parseInt(temp.split(":")[1].slice(-2));
            let minute: number = parseInt(temp.split(":")[2]);
            let second: number = parseInt(temp.split(":")[3].slice(0, 2));

            // Convert 12hr to 24hr
            if (temp.split(";")[1].slice(-2) === "PM" && hour !== 12)
                hour += 12;

            if (temp.split(";")[1].slice(-2) === "AM" && hour === 12)
                hour -= 12;

            rowCompleteDate = new Date(year, month - 1, day, hour, minute, second);
        }


        const row = new PS_RoutingRow({
            op: $(this).find('td:first-of-type > a').text(),
            opDesc: $(this).find("td:nth-of-type(2)").text(),
            resource: $(this).find("td:nth-of-type(3)").text(),
            completeTotal: Number($(this).find('ts:nth-child(7)').text()),
            completeDate: rowCompleteDate,
            workOrderId: wo.id
        });
        await row.save();
    });
}

function parseTrackingTable(wo: PS_WorkOrder): Promise<void> {
    return new Promise(resolve => {
        // Destroy existing tracking records
        PS_TrackingRow.destroy({ where: { workOrderId: wo.id } });

        got(`${baseUrl}/procnc/procncAdmin/viewTimeTracking$viewType=byworkorder&currentYearWos=${wo.index}&userId=all`, {cookieJar})
        .then(res => res.body).then(html => {
            const $ = cheerio.load(html);

            let rows = $('#dataTable > tbody > tr');
            rows.each(async function(this: cheerio.Cheerio) {
                if ($(this).find('td:nth-child(3)').text().trim() !== 'Running')
                    return true;

                let rowTimeStarted: Date = parseTrackingDate($(this).find('td:nth-child(4) > span').text())!;
                let rowTimeEnded:   Date | undefined = parseTrackingDate($(this).find('td:nth-child(5) > span').text());
                let rowOp: number = Number($(this).find('td:nth-child(7)').text());
                let rowResource: string = $(this).find('td:nth-child(8)').text().trim();

                let quantities: string = $(this).find('td:nth-child(12) > span').text();

                // Sometimes quantities are left blank, so we check for this
                // and default values to zero
                let rowBeginQty: number = 0;
                let rowEndQty:   number = 0;
                if (quantities !== '') {
                    rowBeginQty = Number($(this).find('td:nth-child(12) > span').text().split('/')[0]);
                    rowEndQty = Number($(this).find('td:nth-child(12) > span').text().split('/')[1]);
                }
                
                let rowTotalRun: number = Number($(this).find('td:nth-child(13)').text());

                PS_TrackingRow.create({
                    dateStarted: rowTimeStarted,
                    dateEnded: rowTimeEnded,
                    op: rowOp,
                    resource: rowResource,
                    quantityStart: rowBeginQty,
                    quantityEnd: rowEndQty,
                    quantityTotal: rowTotalRun,
                    workOrderId: wo.id
                });
            });
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