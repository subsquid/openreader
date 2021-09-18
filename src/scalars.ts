/**
 * The current concept of custom scalars is as follows:
 *
 * Each custom scalar type has canonical string representation which is used every where:
 *    in JSON requests/responses
 *    in graphql schemas
 *    for database io
 *    for intermediate resolver values
 *
 * Because our canonical representations are used in SQL query parameters and results,
 * database must support 2 way coercions between those and underlying database types.
 */

import {IResolvers} from "@graphql-tools/utils"
import {GraphQLScalarType} from "graphql"


export interface Scalar {
    gql: GraphQLScalarType
    fromStringCast: (sqlExp: string) => string
    toStringCast: (sqlExp: string) => string
}


export const scalars: Record<string, Scalar> = {
    BigInt: {
        gql: new GraphQLScalarType({
            name: 'BigInt',
            description: 'Big number integer',
            serialize(value: number | string) {
                return ''+value
            },
            parseValue(value: string) {
                if (!isBigInt(value)) throw new Error('Not a BigInt: ' + value)
                return value
            },
            parseLiteral(ast) {
                switch(ast.kind) {
                    case "StringValue":
                        if (isBigInt(ast.value)) {
                            if (ast.value[0] == '+') {
                                return ast.value.slice(1)
                            } else {
                                return ast.value
                            }
                        } else {
                            throw new Error('Not a BigInt: ' + ast.value)
                        }
                    case "IntValue":
                        return ''+ast.value
                    default:
                        return null
                }
            }
        }),
        fromStringCast(exp) {
            return `(${exp})::numeric`
        },
        toStringCast(exp) {
            return `(${exp})::text`
        }
    }
}


function isBigInt(s: string): boolean {
    return /^[+\-]?\d+$/.test(s)
}


export const scalars_list = ['ID'].concat(Object.keys(scalars))


export function getScalarResolvers(): IResolvers {
    let resolvers: IResolvers = {}
    for (let type in scalars) {
        resolvers[type] = scalars[type].gql
    }
    return resolvers
}


export function toTransportCast(scalarType: string, sqlExp: string): string {
    let s = scalars[scalarType]
    if (s) {
        return s.toStringCast(sqlExp)
    } else {
        return sqlExp
    }
}


export function fromTransportCast(scalarType: string, sqlExp: string): string {
    let s = scalars[scalarType]
    if (s) {
        return s.fromStringCast(sqlExp)
    } else {
        return sqlExp
    }
}


export function fromJsonCast(scalarType: string, objSqlExp: string, prop: string): string {
    switch(scalarType) {
        case 'Int':
        case 'Float':
            return `(${objSqlExp}->'${prop}')::numeric`
        default:
            return fromTransportCast(scalarType, `${objSqlExp}->>'${prop}'`)
    }
}


export function fromJsonToTransportCast(scalarType: string, objSqlExp: string, prop: string) {
    switch(scalarType) {
        case 'Int':
        case 'Float':
            return `(${objSqlExp}->'${prop}')::numeric`
        default:
            return `${objSqlExp}->>'${prop}'`
    }
}
