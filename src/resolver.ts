import type {IFieldResolver, IResolvers} from "@graphql-tools/utils"
import {UserInputError} from "apollo-server-core"
import assert from "assert"
import type {GraphQLResolveInfo} from "graphql"
import type {ClientBase} from "pg"
import type {Entity, JsonObject, Model} from "./model"
import {QueryBuilder} from "./queryBuilder"
import {
    ConnectionArgs as RelayConnectionArgs,
    ConnectionEdge,
    ConnectionResponse as RelayConnectionResponse,
    decodeConnectionArgs,
    encodeCursor,
    PageInfo
} from "./relayConnection"
import {connectionRequestedFields, ftsRequestedFields, requestedFields} from "./requestedFields"
import {getScalarResolvers} from "./scalars"
import {ensureArray, lowerCaseFirst, toQueryListField, upperCaseFirst} from "./util"


export interface ResolverContext {
    db: ClientBase
    model: Model
}


export function buildResolvers(model: Model): IResolvers {
    let Query: Record<string, IFieldResolver<unknown, ResolverContext>> = {}
    let resolvers: IResolvers = {Query, ...getScalarResolvers()}

    for (let name in model) {
        let item = model[name]
        switch(item.kind) {
            case 'entity':
                Query[toQueryListField(name)] = (source, args, context, info) => {
                    let fields = requestedFields(model, name, info)
                    return new QueryBuilder(context).executeSelect(name, args, fields)
                }
                Query[`${lowerCaseFirst(name)}ById`] = async (source, args, context, info) => {
                    let fields = requestedFields(model, name, info)
                    let result = await new QueryBuilder(context).executeSelect(name, {where: {id_eq: args.id}}, fields)
                    assert(result.length < 2)
                    return result[0]
                }
                Query[`${lowerCaseFirst(name)}ByUniqueInput`] = async (source, args, context, info) => {
                    let fields = requestedFields(model, name, info)
                    let result = await new QueryBuilder(context).executeSelect(name, {where: {id_eq: args.where.id}}, fields)
                    assert(result.length < 2)
                    return result[0]
                }
                Query[toQueryListField(name) + 'Connection'] = (source, args, context, info) => {
                    return resolveEntityConnection(name, args, context, info)
                }
                installFieldResolvers(name, item)
                break
            case 'object':
                installFieldResolvers(name, item)
                break
            case 'union':
                resolvers[name] = {
                    __resolveType: resolveUnionType
                }
                break
            case 'fts':
                Query[name] = (source, args, context, info) => {
                    let fields = ftsRequestedFields(model, name, info)
                    return new QueryBuilder(context).executeFulltextSearch(name, args, fields)
                }
                resolvers[`${upperCaseFirst(name)}_Item`] = {
                    __resolveType: resolveUnionType
                }
                break
        }
    }

    function installFieldResolvers(name: string, object: Entity | JsonObject): void {
        let fields: Record<string, IFieldResolver<any, any>> = {}
        for (let key in object.properties) {
            switch(object.properties[key].type.kind) {
                case 'object':
                case 'union':
                case 'fk':
                case 'list-relation':
                    fields[key] = aliasResolver
                    break
            }
        }
        resolvers[name] = fields
    }

    return resolvers
}


function resolveUnionType(source: any): string {
    return source.isTypeOf
}


function aliasResolver(source: any, args: unknown, ctx: unknown, info: GraphQLResolveInfo): any {
    return source[info.path.key]
}


interface ConnectionArgs extends RelayConnectionArgs {
    orderBy?: string[]
    where?: any
}


interface ConnectionResponse extends RelayConnectionResponse<any> {
    totalCount?: number
}


async function resolveEntityConnection(
    entityName: string,
    args: ConnectionArgs,
    context: ResolverContext,
    info: GraphQLResolveInfo
): Promise<ConnectionResponse> {
    let response: ConnectionResponse = {}

    let orderBy = args.orderBy && ensureArray(args.orderBy)
    if (!orderBy?.length) {
        throw new UserInputError('orderBy argument is required for connection')
    }

    let {offset, limit} = decodeConnectionArgs(args)
    let listArgs = {
        where: args.where,
        orderBy,
        offset,
        limit: limit + 1
    }

    // https://relay.dev/assets/files/connections-932f4f2cdffd79724ac76373deb30dc8.htm#sec-undefined.PageInfo.Fields
    function pageInfo(listLength: number): PageInfo {
        return {
            hasNextPage: listLength > limit,
            hasPreviousPage: listLength > 0 && offset > 0,
            startCursor: listLength > 0 ? encodeCursor(offset + 1) : '',
            endCursor: listLength > 0 ? encodeCursor(offset + Math.min(limit, listLength)) : ''
        }
    }

    let fields = connectionRequestedFields(context.model, entityName, info)
    if (fields.edges?.node) {
        let nodes = await new QueryBuilder(context).executeSelect(entityName, listArgs, fields.edges.node)
        let edges: ConnectionEdge<any>[] = new Array(Math.min(limit, nodes.length))
        for (let i = 0; i < edges.length; i++) {
            edges[i] = {
                node: nodes[i],
                cursor: encodeCursor(offset + i + 1)
            }
        }
        response.edges = edges
        response.pageInfo = pageInfo(nodes.length)
        if (nodes.length > 0 && nodes.length <= limit) {
            response.totalCount = offset + nodes.length
        }
    } else if (fields.edges?.cursor || fields.pageInfo) {
        let listLength = await new QueryBuilder(context).executeListCount(entityName, listArgs)
        response.pageInfo = pageInfo(listLength)
        if (fields.edges?.cursor) {
            response.edges = []
            for (let i = 0; i < Math.min(limit, listLength); i++) {
                response.edges.push({
                    cursor: encodeCursor(offset + i + 1)
                })
            }
        }
        if (listLength > 0 && listLength <= limit) {
            response.totalCount = offset + listLength
        }
    }

    if (fields.totalCount && response.totalCount == null) {
        response.totalCount = await new QueryBuilder(context).executeSelectCount(entityName, listArgs.where)
    }

    return response
}
