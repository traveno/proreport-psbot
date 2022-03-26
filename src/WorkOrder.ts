export enum PS_WorkOrder_Status { ACTIVE = 0, CANCELED, COMPLETE, INVOICED, MANUFACTURING_COMPLETE, ON_HOLD, SHIPPED, UNKNOWN }

export interface PS_WorkOrder {
    index: string,
    status: PS_WorkOrder_Status,
    orderQuantity: number
}

export function statusToEnum(status: string): PS_WorkOrder_Status {
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