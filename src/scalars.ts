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
 *
 * One exception is DateTime. We receive it from database in native format (getting Date objects from driver),
 * then convert it to string with gql resolver.
 */

import {IResolvers} from "@graphql-tools/utils"
import {GraphQLScalarType} from "graphql"


export interface Scalar {
    gql: GraphQLScalarType
    fromStringCast: (sqlExp: string) => string
    toStringCast: (sqlExp: string) => string
    fromStringArrayCast: (sqlExp: string) => string
    toStringArrayCast: (sqlExp: string) => string
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
                if (!isBigInt(value)) throw invalidFormat('BigInt', value)
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
                            throw invalidFormat('BigInt', ast.value)
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
        },
        fromStringArrayCast(exp) {
            return `(${exp})::numeric[]`
        },
        toStringArrayCast(exp) {
            return `(${exp})::text[]`
        }
    },
    DateTime: {
        gql: new GraphQLScalarType({
            name: 'DateTime',
            description:
                'A date-time string in simplified extended ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)',
            serialize(value: Date | string) {
                if (value instanceof Date) {
                    return value.toISOString()
                } else {
                    if (!isIsoDateTimeString(value)) throw invalidFormat('DateTime', value)
                    return value
                }
            },
            parseValue(value: string) {
                return parseDateTime(value)
            },
            parseLiteral(ast) {
                switch(ast.kind) {
                    case "StringValue":
                        return parseDateTime(ast.value)
                    default:
                        return null
                }
            }
        }),
        fromStringCast(exp) {
            return `(${exp})::timestamptz`
        },
        toStringCast(exp) {
            return exp
        },
        fromStringArrayCast(exp) {
            return `(${exp})::timestamptz[]`
        },
        toStringArrayCast(exp) {
            return exp
        }
    },
    Bytes: {
        gql: new GraphQLScalarType({
            name: 'Bytes',
            description: 'Binary data encoded as a hex string always prefixed with 0x',
            serialize(value: string) {
                if (!isBytesString(value)) throw invalidFormat('Bytes', value)
                return value.toLowerCase()
            },
            parseValue(value: string) {
                return parseBytes(value)
            },
            parseLiteral(ast) {
                switch(ast.kind) {
                    case "StringValue":
                        return parseBytes(ast.value)
                    default:
                        return null
                }
            }
        }),
        fromStringCast(exp) {
            return `decode(substr(${exp}, 3), 'hex')`
        },
        toStringCast(exp) {
            return `'0x' || encode(${exp}, 'hex')`
        },
        fromStringArrayCast(exp) {
            return `array(select decode(substr(i, 3), 'hex') from unnest((${exp})::text[]) as i)`
        },
        toStringArrayCast(exp) {
            return `array(select '0x' || encode(i, 'hex') from unnest(${exp}) as i)`
        }
    }
}


function isBigInt(s: string): boolean {
    return /^[+\-]?\d+$/.test(s)
}


// credit - https://github.com/Urigo/graphql-scalars/blob/91b4ea8df891be8af7904cf84751930cc0c6613d/src/scalars/iso-date/validator.ts#L122
const RFC_3339_REGEX = /^(\d{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60))(\.\d{1,})?([Z])$/


function isIsoDateTimeString(s: string): boolean {
    return RFC_3339_REGEX.test(s)
}


function parseDateTime(s: string): string {
    if (!isIsoDateTimeString(s)) throw invalidFormat('DateTime', s)
    let timestamp = Date.parse(s)
    if (isNaN(timestamp)) throw invalidFormat('DateTime', s)
    return s
}


function isBytesString(s: string): boolean {
    return s.length % 2 == 0 && /^0x[a-f0-9]+$/i.test(s)
}


function parseBytes(s: string): string {
    if (!isBytesString(s)) throw invalidFormat('Bytes', s)
    return s.toLowerCase()
}


function invalidFormat(type: string, value: string): Error {
    return new TypeError(`Not a ${type}: ${value}`)
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


export function toTransportArrayCast(scalarType: string, sqlExp: string): string {
    let s = scalars[scalarType]
    if (s) {
        return s.toStringArrayCast(sqlExp)
    } else {
        return sqlExp
    }
}


export function fromTransportArrayCast(scalarType: string, sqlExp: string): string {
    let s = scalars[scalarType]
    if (s) {
        return s.fromStringArrayCast(sqlExp)
    } else {
        return sqlExp
    }
}


export function fromJsonCast(scalarType: string, objSqlExp: string, prop: string): string {
    switch(scalarType) {
        case 'Int':
            return `(${objSqlExp}->>'${prop}')::integer`
        case 'Float':
            return `(${objSqlExp}->>'${prop}')::numeric`
        default:
            return fromTransportCast(scalarType, `${objSqlExp}->>'${prop}'`)
    }
}


export function fromJsonToTransportCast(scalarType: string, objSqlExp: string, prop: string) {
    switch(scalarType) {
        case 'Int':
            return `(${objSqlExp}->'${prop}')::integer`
        case 'Float':
            return `(${objSqlExp}->'${prop}')::numeric`
        default:
            return `${objSqlExp}->>'${prop}'`
    }
}
