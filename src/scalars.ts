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
import BN from "bn.js"


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
                // TODO: checks are simple, no need for BN here
                new BN(value)
                return value
            },
            parseLiteral(ast) {
                switch(ast.kind) {
                    case "StringValue":
                    case "IntValue":
                        // TODO: checks are simple, no need for BN here
                        new BN(ast.value)
                        return ''+ast.value
                    default:
                        return null
                }
            }
        }),
        fromStringCast(exp) {
            return exp + '::numeric'
        },
        toStringCast(exp) {
            return exp + '::text'
        }
    }
}


export const scalars_list = ['ID'].concat(Object.keys(scalars))


export function getScalarResolvers(): IResolvers {
    let resolvers: IResolvers = {}
    for (let type in scalars) {
        resolvers[type] = scalars[type].gql
    }
    return resolvers
}


export function toStringCast(scalarType: string, sqlExp: string): string {
    let s = scalars[scalarType]
    if (s) {
        return s.toStringCast(sqlExp)
    } else {
        return sqlExp
    }
}


export function fromStringCast(scalarType: string, sqlExp: string): string {
    let s = scalars[scalarType]
    if (s) {
        return s.fromStringCast(sqlExp)
    } else {
        return sqlExp
    }
}
