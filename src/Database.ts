import { PS_WorkOrder, PS_WorkOrder_Status } from './WorkOrder';
import { PS_Update_Options } from './ProData';

export enum PS_Database_Status { EMPTY = 0, OUTDATED, OK, ERROR, UNSAVED_CHANGES }

export interface PS_Database_Filter {
    resource?: string,
    status?: PS_WorkOrder_Status
    upToOp?: number
}

export class PS_Database {
    private timestamp_data: Date;
    private timestamp_save: Date;
    private workorders: PS_WorkOrder[] = new Array();

    constructor() {
        this.timestamp_data = new Date();
        this.timestamp_save = new Date();
        this.workorders = new Array();
    }

    loadFromFile(initFile: File): Promise<void> {
        return new Promise(resolve => {
            let reader = new FileReader();
            reader.readAsText(initFile);

            reader.onloadend = (event: any) => {
                let content: string = event.target.result as string;
                let parse: any = JSON.parse(content);

                // Copy timestamps from file
                this.timestamp_data = new Date(parse.timestamp_data);
                this.timestamp_save = new Date(parse.timestamp_save);

                // Bring in all work orders from file
                for (let wo of parse.workorders) {

                    this.workorders.push(new PS_WorkOrder(wo));
                }
                resolve();
            }
        });
    }

    getStatus(): PS_Database_Status {
        if (this.timestamp_data === undefined)
            return PS_Database_Status.EMPTY;
        else if (this.timestamp_data.getDate() != new Date().getDate())
            return PS_Database_Status.OUTDATED;
        else if (this.timestamp_data > this.timestamp_save)
            return PS_Database_Status.UNSAVED_CHANGES;
        else if (this.timestamp_data.getDate() === new Date().getDate())
            return PS_Database_Status.OK
        else
            return PS_Database_Status.ERROR;
    }

    getMatchingUpdateCriteria(options: PS_Update_Options): string[] {
        let temp: string[] = [];

        for (let wo of this.workorders) {
            if (wo.matchesUpdateCriteria(options))
                temp.push(wo.index);
        }

        return temp;
    }

    getMatchingStatus(status: PS_WorkOrder_Status): string[] {
        let temp: string[] = []

        for (let wo of this.workorders) {
            if (wo.getStatus() === PS_WorkOrder_Status.UNKNOWN)
                temp.push(wo.index);
        }

        return temp;
    }

    getDataTimestamp(): Date {
        return this.timestamp_data;
    }

    getNumberOfEntries(): number {
        return this.workorders.length;
    }

    getAllWorkOrders(): PS_WorkOrder[] {
        return this.workorders;
    }

    updateDataTimestamp(): void {
        this.timestamp_data = new Date();
    }

    updateSaveTimestamp(): void {
        this.timestamp_save = new Date();
    }

    containsWorkOrder(index: string) {
        return this.workorders.find(elem => elem.index === index);
    }

    filter(options: PS_Database_Filter): PS_WorkOrder[] {
        let temp: PS_WorkOrder[] = new Array();

        // We begin
        for (let wo of this.workorders) {
            // Filter by work order status if defined
            if (options.status !== undefined)
                if (wo.status !== options.status)
                    continue;

            // Filter by machine resource (all ops) if defined
            if (options.resource !== undefined)
                if (!wo.containsResource(options.resource))
                    continue;

            temp.push(wo);
        }
        return temp;
    }

    async fetchWorkOrder(index: string | undefined, callback?: any): Promise<void> {
        if (index === undefined) return;
        // If this already exists in our cache, fetch new data
        let duplicateFinder = this.workorders.find(elem => elem.index === index);

        // If work order exists, fetch new data for existing record
        if (duplicateFinder)
            await duplicateFinder.fetch();
        else {
            // Create new work order object and push onto stack
            let wo: PS_WorkOrder = new PS_WorkOrder();
            await wo.createFromIndex(index);
            this.workorders.push(wo);
        }

        // ProData callback
        if (callback)
            callback();
    }

    verify(): boolean {
        for (let wo of this.workorders) {
            for (let test of this.workorders) {
                if (this.workorders.indexOf(wo) !== this.workorders.indexOf(test) &&
                    wo == test) {
                    return false;
                }
            }
        }

        return true;
    }
}

function handleFetchErrors(response: any) {
    if (!response.ok)
        throw Error(response.statusText);
    return response;
}