import {UserInputError} from "apollo-server"
import assert from "assert"
import {GraphQLResolveInfo, GraphQLSchema} from "graphql"
import {
    FieldsByTypeName,
    parseResolveInfo,
    ResolveTree,
    simplifyParsedResolveInfoFragmentWithType
} from "graphql-parse-resolve-info"
import {Model, PropType} from "./model"


export interface RequestedFields {
    [name: string]: RequestedField
}


export interface RequestedField {
    propType: PropType
    requests: FieldRequest[]
}


export interface FieldRequest {
    alias: string
    children?: RequestedFields
    args?: any
    ifType?: string
    index: number
}


export function requestedFields(model: Model, entityName: string, info: GraphQLResolveInfo): RequestedFields {
    let tree = getResolveTree(info)
    return collectRequestedFields(model, entityName, info.schema, tree)
}


function collectRequestedFields(model: Model, objectName: string, schema: GraphQLSchema, tree: ResolveTree): RequestedFields {
    let requested: RequestedFields = {}
    let object = model[objectName]
    assert(object.kind == 'entity' || object.kind == 'object')

    let fields = simplifyResolveTree(schema, tree, objectName).fields
    for (let alias in fields) {
        let f = fields[alias]
        let prop = object.properties[f.name]
        let propType = prop.type
        switch(propType.kind) {
            case 'scalar':
            case 'enum':
                requested[f.name] = {
                    propType,
                    requests: [{alias: f.name, index: 0}]
                }
                break
            case 'object':
                addRequest(requested, f.name, propType, {
                    alias,
                    children: collectRequestedFields(model, propType.name, schema, f),
                    index: 0
                })
                break
            case 'fk':
                addRequest(requested, f.name, propType, {
                    alias,
                    children: collectRequestedFields(model, propType.foreignEntity, schema, f),
                    index: 0
                })
                break
            case 'list-relation':
                addRequest(requested, f.name, propType, {
                    alias,
                    args: f.args,
                    children: collectRequestedFields(model, propType.entity, schema, f),
                    index: 0
                })
                break
            case 'union':{
                let union = model[propType.name]
                assert(union.kind == 'union')
                let map: Record<string, RequestedFields> = {}
                union.variants.forEach(name => {
                    map[name] = collectRequestedFields(model, name, schema, f)
                })
                addRequest(requested, f.name, propType, {
                    alias,
                    children: mergeUnionRequests(map),
                    index: 0
                })
                break
            }
            default:
                throw new Error(`Requested field ${objectName}.${f.name} of unsupported type`)
        }
    }

    return requested
}


function mergeUnionRequests(union: Record<string, RequestedFields>): RequestedFields {
    let requested: RequestedFields = {}
    for (let name in union) {
        let fields = union[name]
        for (let key in fields) {
            let field = fields[key]
            switch(field.propType.kind) {
                case 'scalar':
                case 'enum':
                    requested[key] = field
                    break
                default:
                    field.requests.forEach(req => {
                        addRequest(requested, key, field.propType, {...req, ifType: name})
                    })
            }
        }
    }
    return requested
}


function addRequest(requested: RequestedFields, name: string, propType: PropType, req: FieldRequest): void {
    let field = requested[name]
    if (field == null) {
        requested[name] = {
            propType,
            requests: [req]
        }
    } else {
        field.requests.push(req)
    }
}


export interface ConnectionRequestedFields {
    totalCount?: boolean
    pageInfo?: boolean
    edges?: {
        node?: RequestedFields
        cursor?: boolean
    }
}


export function connectionRequestedFields(model: Model, entityName: string, info: GraphQLResolveInfo): ConnectionRequestedFields {
    let requested: ConnectionRequestedFields = {}
    let tree = getResolveTree(info, entityName + 'Connection')
    requested.totalCount = hasTreeRequest(tree.fields, 'totalCount')
    requested.pageInfo = hasTreeRequest(tree.fields, 'pageInfo')
    let edgesTree = getTreeRequest(tree.fields, 'edges')
    if (edgesTree) {
        let edgeFields = simplifyResolveTree(info.schema, edgesTree, entityName + 'Edge').fields
        requested.edges = {}
        requested.edges.cursor = hasTreeRequest(edgeFields, 'cursor')
        let nodeTree = getTreeRequest(edgeFields, 'node')
        if (nodeTree) {
            requested.edges.node = collectRequestedFields(model, entityName, info.schema, nodeTree)
        }
    }
    return requested
}


function getTreeRequest(treeFields: ResolveTreeFields, fieldName: string): ResolveTree | undefined {
    let req: ResolveTree | undefined
    for (let alias in treeFields) {
        let e = treeFields[alias]
        if (e.name != fieldName) continue
        if (req != null) throw new UserInputError(`multiple aliases for field '${fieldName}' are not supported`)
        req = e
    }
    return req
}


function hasTreeRequest(treeFields: ResolveTreeFields, fieldName: string): boolean {
    for (let alias in treeFields) {
        let e = treeFields[alias]
        if (e.name == fieldName) return true
    }
    return false
}


type ResolveTreeFields = {
    [alias: string]: ResolveTree
}


interface ResolveTreeWithFields extends ResolveTree {
    fields: ResolveTreeFields
}


function getResolveTree(info: GraphQLResolveInfo): ResolveTree
function getResolveTree(info: GraphQLResolveInfo, typeName: string): ResolveTreeWithFields
function getResolveTree(info: GraphQLResolveInfo, typeName?: string): ResolveTree {
    let tree = parseResolveInfo(info)
    assert(isResolveTree(tree))
    if (typeName) {
        return simplifyResolveTree(info.schema, tree, typeName)
    } else {
        return tree
    }
}


function simplifyResolveTree(schema: GraphQLSchema, tree: ResolveTree, typeName: string): ResolveTreeWithFields {
    let type = schema.getType(typeName)
    assert(type != null)
    return simplifyParsedResolveInfoFragmentWithType(tree, type)
}


function isResolveTree(resolveInfo: ResolveTree | FieldsByTypeName | null | undefined): resolveInfo is ResolveTree {
    return resolveInfo != null && resolveInfo.fieldsByTypeName != null
}
