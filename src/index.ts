import got from 'got';
import * as cheerio from 'cheerio';
import { CookieJar, Cookie } from 'tough-cookie';
import fs from 'fs';

import { statusToEnum } from './WorkOrder.js';
import { updateWorkOrder } from './queries.js';

// Base URL
const baseUrl = 'https://machinesciences.adionsystems.com';

// Load in auth details -- SENSITIVE DATA DO NOT COMMIT
const authJson: any = JSON.parse(fs.readFileSync('auth.json').toString());

// Create a cookie jar to hold our authentication cookie
const cookieJar = new CookieJar();

// Check for existing authentication cookie
if (authJson.cookie !== undefined)
    cookieJar.setCookieSync(authJson.cookie, 'https://machinesciences.adionsystems.com/procnc/');

// Run PSBot
activateBot();

async function activateBot() {
    // Check if we are logged in
    let loggedIn = await isAuthenticated();
    console.log(`Authenticated status: ${loggedIn}`);

    // If not logged in, attemp to log in
    // I am using cookies in place of plaintext auth at the moment!
    // If for some reason the cookie becomes invalid, it will try to log in via username and password
    if (!loggedIn) {
        if (authJson.username === '' || authJson.password === '')
            throw Error('auth.json is missing log in details');

        console.log('Logging in...');
        await logIn();

        loggedIn = await isAuthenticated();

        // Something is wrong with our login details
        if (!loggedIn)
            throw Error('Could not log in!');
        
        console.log(`Successfully logged in`);
    }

    // Begin navigating the website
    console.log('Commence the scrape');

    let updateList = await buildUpdateList();

    executeUpdateList(updateList);

    // got('https://machinesciences.adionsystems.com/procnc/workorders/2022/22-0149$', {cookieJar})
    // .then(res => res.body).then(html => {
    //     let $ = cheerio.load(html);
    //     console.log($('title').text());

    //     let wo_index = $('#horizontalMainAtts_workOrderNumber_value').text();
    //     let wo_status = statusToEnum($('#horizontalMainAtts_status_value').text());
    //     let wo_orderQuantity = Number($('#horizontalMainAtts_quantityordered_value').text());

    //     sendWorkOrder({
    //         index: wo_index,
    //         status: wo_status,
    //         orderQuantity: wo_orderQuantity
    //     });
    // });
}

async function executeUpdateList(list: string[]) {
    for (let wo of list) {
        await fetchWorkOrder(wo);
    }
}

function fetchWorkOrder(index: string): Promise<void> {
    return new Promise(resolve => {
        got(`${baseUrl}/procnc/workorders/${index}`, {cookieJar})
        .then(res => res.body).then(html => {
            let $ = cheerio.load(html);
            console.log($('title').text());

            let wo_index = $('#horizontalMainAtts_workOrderNumber_value').text();
            let wo_status = statusToEnum($('#horizontalMainAtts_status_value').text());
            let wo_orderQuantity = Number($('#horizontalMainAtts_quantityordered_value').text());

            updateWorkOrder({
                index: wo_index,
                status: wo_status,
                orderQuantity: wo_orderQuantity
            });

            resolve();
        });
    });
}

function buildUpdateList(): Promise<string[]> {
    return new Promise(resolve => {
        got(`${baseUrl}/procnc/workorders/searchresults$queryScope=global&queryName=query55&pName=workorders`, {cookieJar})
        .then(res => res.body).then(html => {
            let $ = cheerio.load(html);

            let table: cheerio.Cheerio = $('#dataTable');
            let tableRows = $(table).find('tbody > tr');

            let list: string[] = [];

            for (let row of tableRows)
                list.push($(row).find('td:nth-child(1) > a:nth-child(1)').text());
            
            resolve(list);
        });
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
                mailAddress: authJson.username,
                password: authJson.password,
                rememberLogin: true
            },
            cookieJar
        }).then(() => {
            resolve();
        });
    });
}