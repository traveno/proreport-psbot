import pg from 'pg';
const { Pool } = pg;

import { PS_WorkOrder } from './WorkOrder';

// Default to dev config for database
var dbInfo: any = {
    user: 'proreport',
    host: 'localhost',
    database: 'proreport',
    password: 'test',
    port: 5432
};

// Check for production environment
if (process.env.NODE_ENV === 'production') {
    dbInfo = {
        user: 'proreport',
        host: '/var/run/postgresql',
        database: 'proreport',
        port: 5432
    }
}

const pool = new Pool(dbInfo);



function createWorkOrder(wo: PS_WorkOrder) {
    let q = `INSERT INTO workorders (index, status, order_quantity) VALUES ('${wo.index}', ${wo.status}, ${wo.orderQuantity});`;
    pool.query(q, (error, results) => {
        if (error) throw error;
    });
}

export async function updateWorkOrder(wo: PS_WorkOrder) {
    let id = await doesWorkOrderExist(wo);

    if (id === -1)
        createWorkOrder(wo);

    let q = `UPDATE workorders SET status = ${wo.status}, order_quantity = ${wo.orderQuantity} WHERE id = ${id};`;
    pool.query(q, (error, results) => {
        if (error) throw error;
        console.log(results.rows);
    });
}

function doesWorkOrderExist(wo: PS_WorkOrder): Promise<number> {
    return new Promise(resolve => {
        let q = `SELECT id FROM workorders WHERE index = '${wo.index}' LIMIT 1;`;
        pool.query(q, (error, results) => {
            if (error) throw error;

            if (results.rows.length === 0)
                resolve(-1);
            else
                resolve(results.rows[0].id);
        });
    });
}