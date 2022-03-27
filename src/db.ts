import { AutoIncrement, BelongsTo, Column, DataType, ForeignKey, HasMany, Model, PrimaryKey, Sequelize, Table } from 'sequelize-typescript';
import 'dotenv/config';
import { Dialect } from 'sequelize/types';

@Table
export class PS_WorkOrder extends Model {
    @PrimaryKey
    @AutoIncrement
    @Column(DataType.BIGINT)
    id!: number;

    @Column
    index!: string

    @Column
    status!: number

    @Column
    orderQuantity!: number

    @HasMany(() => PS_RoutingRow)
    routingRows!: PS_RoutingRow[];

    @HasMany(() => PS_TrackingRow)
    trackingRows!: PS_TrackingRow[];
}

@Table
export class PS_RoutingRow extends Model {
    @PrimaryKey
    @AutoIncrement
    @Column(DataType.BIGINT)
    id!: number;

    @Column
    op!: string;

    @Column
    opDesc!: string;

    @Column
    resource!: string;

    @Column(DataType.DECIMAL)
    completeTotal!: number;

    @Column(DataType.DATE)
    completeDate!: Date | null

    @ForeignKey(() => PS_WorkOrder)
    @Column
    workOrderId!: number;

    @BelongsTo(() => PS_WorkOrder)
    workOrder!: PS_WorkOrder;
}

@Table
export class PS_TrackingRow extends Model {
    @PrimaryKey
    @AutoIncrement
    @Column(DataType.BIGINT)
    id!: number;
    
    @Column
    dateStarted!: Date;

    @Column
    dateEnded!: Date;

    @Column
    op!: string;

    @Column
    resource!: string;

    @Column(DataType.DECIMAL)
    quantityStart!: number;

    @Column(DataType.DECIMAL)
    quantityEnd!: number;

    @Column(DataType.DECIMAL)
    quantityTotal!: number;

    @ForeignKey(() => PS_WorkOrder)
    @Column
    workOrderId!: number;

    @BelongsTo(() => PS_WorkOrder)
    workOrder!: PS_WorkOrder;
}

export const sequelize = new Sequelize({
    username: process.env.DB_USER!,
    password: process.env.DB_PASS!,
    database: process.env.DB_NAME!,
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT),
    dialect: process.env.DB_DIALECT! as Dialect,
    models: [PS_WorkOrder, PS_RoutingRow, PS_TrackingRow],
    logging: false
});