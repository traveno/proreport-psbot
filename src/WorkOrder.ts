import $, { Cash } from 'cash-dom';
import fetch from 'node-fetch';
import { BASE_URL, PS_Update_Options } from "./ProData";

export enum PS_WorkOrder_Status { ACTIVE = 0, CANCELED, COMPLETE, INVOICED, MANUFACTURING_COMPLETE, ON_HOLD, SHIPPED, UNKNOWN }

export interface PS_WorkOrder_OpRow {
    op: string,
    opDesc: string,
    resource: string,
    complete: boolean,
    completeTotal?: number,
    completeDate?: Date;
}

export interface PS_WorkOrder_TrackingRow {
    timeStarted: Date,
    timeEnded?: Date,
    op: number,
    resource: string,
    beginQuantity: number,
    endQuantity: number,
    totalRun: number
}

export class PS_WorkOrder {
    index: string = '00-0000';
    status: PS_WorkOrder_Status = PS_WorkOrder_Status.UNKNOWN;
    orderQuantity: number = -1;
    orderValue: number = -1;
    
    routingTable: PS_WorkOrder_OpRow[] = [];
    trackingTable: PS_WorkOrder_TrackingRow[] = [];

    constructor(copy?: PS_WorkOrder) {
        if (!copy) return;

        this.index = copy.index;
        this.status = copy.status;
        this.orderQuantity = copy.orderQuantity;
        this.orderValue = copy.orderValue;

        // Copy routing table
        for (let row of copy.routingTable) {
            this.routingTable.push({
                op: row.op,
                opDesc: row.opDesc,
                resource: row.resource,
                complete: row.complete,
                completeTotal: row.completeTotal,
                completeDate: row.completeDate !== undefined ? new Date(row.completeDate) : undefined
            });
        }

        // Copy time tracking table
        for (let row of copy.trackingTable) {
            this.trackingTable.push({
                timeStarted: new Date(row.timeStarted),
                timeEnded: row.timeEnded ? new Date(row.timeEnded) : undefined,
                op: row.op,
                resource: row.resource,
                beginQuantity: row.beginQuantity,
                endQuantity: row.endQuantity,
                totalRun: row.totalRun
            });
        }
    }

    async createFromIndex(index: string): Promise<void> {
        this.index = index;
        await this.fetch();
    }

    fetch(): Promise<void> {
        return new Promise(resolve => {
            fetch(`${BASE_URL}/procnc/workorders/${this.index}`).then(res => res.text()).then(html => {
                let parser: DOMParser = new DOMParser();
                let doc: Document = parser.parseFromString(html, "text/html");
    
                // Set our work order's internal data
                let status: string = $(doc).find("#horizontalMainAtts_status_value").text();
                let routingTable: Cash = $(doc).find('table.proshop-table').eq(5);
                this.orderQuantity = Number($(doc).find('#horizontalMainAtts_quantityordered_value').text());
                this.orderValue = -1;
    
                this.setStatusFromString(status);
                this.parseRoutingTable(routingTable);

                // Done fetching external data for this work order

                return fetch(`${BASE_URL}/procnc/procncAdmin/viewTimeTracking$viewType=byworkorder&currentYearWos=${this.index}&userId=all`);
            }).then(res => res.text()).then(html => {
                let parser: DOMParser = new DOMParser();
                let doc: Document = parser.parseFromString(html, "text/html");

                let trackingTable: Cash = $(doc).find('#dataTable > tbody > tr');

                // Check if tracking table is zero length, if so, return
                if (trackingTable.length === 0)
                    return;

                this.parseTrackingTable(trackingTable);
            }).then(() => {
                resolve();
            });
        });
    }

    parseRoutingTable(table: Cash): void {
        let tableRows: Cash = $(table).find("tbody > tr");

        for (let row of tableRows) {
            let rowOp: string = $(row).find("td:first-of-type > a").text();
            let rowDesc: string = $(row).find("td:nth-of-type(2)").text();
            let rowResource: string = $(row).find("td:nth-of-type(3)").text()
            let rowComplete: boolean = $(row).find("td:nth-of-type(10) span").hasClass("glyphicon-ok");

            let rowCompleteTotal: number | undefined = undefined;
            rowCompleteTotal = Number($(row).find('td:nth-child(7)').text());

            let rowCompleteDate: Date | undefined = undefined;
            let rowCompleteDate_string: string | null = $(row).find("td:nth-of-type(10) span").attr("title");
    
            if (rowComplete && rowCompleteDate_string !== null) {
                rowCompleteDate = parseRoutingDate(rowCompleteDate_string)
            }

            this.routingTable.push({
                op: rowOp,
                opDesc: rowDesc,
                resource: rowResource,
                complete: rowComplete,
                completeTotal: rowCompleteTotal,
                completeDate: rowCompleteDate
            });
        }
    }

    parseTrackingTable(tableRows: Cash): void {
        for (let row of tableRows) {
            // For now, only track 'Running' category
            if ($(row).find('td:nth-child(3)').text().trim() !== 'Running')
                continue;

            let rowTimeStarted: Date = parseTrackingDate($(row).find('td:nth-child(4) > span').text())!;
            let rowTimeEnded:   Date | undefined = parseTrackingDate($(row).find('td:nth-child(5) > span').text());
            let rowOp: number = Number($(row).find('td:nth-child(7)').text());
            let rowResource: string = $(row).find('td:nth-child(8)').text().trim();

            let quantities: string = $(row).find('td:nth-child(12) > span').text();

            // Sometimes quantities are left blank, so we check for this
            // and default values to zero
            let rowBeginQty: number = 0;
            let rowEndQty:   number = 0;
            if (quantities !== '') {
                rowBeginQty = Number($(row).find('td:nth-child(12) > span').text().split('/')[0]);
                rowEndQty = Number($(row).find('td:nth-child(12) > span').text().split('/')[1]);
            }
            
            let rowTotalRun: number = Number($(row).find('td:nth-child(13)').text());

            this.trackingTable.push({
                timeStarted: rowTimeStarted,
                timeEnded: rowTimeEnded,
                op: rowOp,
                resource: rowResource,
                beginQuantity: rowBeginQty,
                endQuantity: rowEndQty,
                totalRun: rowTotalRun
            });
        }
    }

    matchesUpdateCriteria(options: PS_Update_Options): boolean {
        // Hardcoded to always attempt to update unknown status work orders
        if (this.status === PS_WorkOrder_Status.UNKNOWN && 
            options.statuses.includes(PS_WorkOrder_Status.UNKNOWN))
            return true;

        if (!options.statuses.includes(this.status))
            return false;

        for (let row of this.routingTable) 
            for (let machine of options.machines) {
                if (row.resource.slice(0, machine.length).toLowerCase() === machine.toLowerCase())
                    return true;
            }
        return false;
    }

    // Return first op row that matches op code
    getRoutingTableRow(opCode: string): PS_WorkOrder_OpRow | undefined {
        return this.routingTable.find(elem => elem.op === opCode);
    }

    containsResource(resource: string): boolean {
        for (let row of this.routingTable) {
            if (row.resource.toLowerCase() === resource.toLowerCase())
                return true;
        }
        return false;
    }

    getStatus(): PS_WorkOrder_Status {
        return this.status;
    }

    setStatusFromString(inputString: string): boolean {
        let inputStringCleaned: string = inputString.trim().toLowerCase();

        if (inputStringCleaned === 'active')
            this.status = PS_WorkOrder_Status.ACTIVE;
        else if (inputStringCleaned === 'canceled')
            this.status = PS_WorkOrder_Status.CANCELED;
        else if (inputStringCleaned === 'complete')
            this.status = PS_WorkOrder_Status.COMPLETE;
        else if (inputStringCleaned === 'invoiced')
            this.status = PS_WorkOrder_Status.INVOICED;
        else if (inputStringCleaned === 'manufacturing complete')
            this.status = PS_WorkOrder_Status.MANUFACTURING_COMPLETE;
        else if (inputStringCleaned === 'on hold')
            this.status = PS_WorkOrder_Status.ON_HOLD;
        else if (inputStringCleaned === 'shipped')
            this.status = PS_WorkOrder_Status.SHIPPED;
        else {
            this.status = PS_WorkOrder_Status.UNKNOWN;
            return false;
        }

        return true;
    }
}

export function parseRoutingDate(date: string): Date {
    let month: number = parseInt(date.split("/")[0].slice(-2));
    let day: number = parseInt(date.split("/")[1]);
    let year: number = parseInt(date.split("/")[2].slice(0, 4));
    let hour: number = parseInt(date.split(":")[1].slice(-2));
    let minute: number = parseInt(date.split(":")[2]);
    let second: number = parseInt(date.split(":")[3].slice(0, 2));

    // Convert 12hr to 24hr
    if (date.split(";")[1].slice(-2) === "PM" && hour !== 12)
        hour += 12;

    if (date.split(";")[1].slice(-2) === "AM" && hour === 12)
        hour -= 12;

    return new Date(year, month - 1, day, hour, minute, second);
}

export function parseTrackingDate(date: string): Date | undefined {
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