import {UserInputError} from "apollo-server"
import assert from "assert"
import type {OpenCrudOrderByValue} from "./orderBy"


export interface PageInfo {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor: string
    endCursor: string
}


export interface Cursor {
    orderBy: OpenCrudOrderByValue[]
    offset: number
}


export function encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64')
}


export function decodeCursor(value: string): Cursor {
    let cursor: any
    try {
        let json = Buffer.from(value, 'base64').toString('utf-8')
        cursor = JSON.parse(json)
        assert(typeof cursor == 'object')
        assert(Array.isArray(cursor.orderBy))
        assert(cursor.orderBy.length > 0)
        assert(cursor.orderBy.every((item: any) => typeof item == 'string'))
        assert(typeof cursor.offset == 'number')
        assert(cursor.offset > 0)
        assert(isFinite(cursor.offset))
        return {orderBy: cursor.orderBy, offset: cursor.offset}
    } catch(e: any) {
        throw new InvalidCursorValue(value)
    }
}


export class InvalidCursorValue extends UserInputError {
    constructor(value: string) {
        super(`invalid cursor value: ${value}`)
    }
}
