import {gql} from "apollo-server"
import assert from "assert"
import {
    buildASTSchema,
    DocumentNode,
    extendSchema,
    GraphQLEnumType,
    GraphQLField,
    GraphQLList,
    GraphQLNamedType,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLScalarType,
    GraphQLSchema,
    GraphQLUnionType
} from "graphql"
import {DirectiveNode} from "graphql/language/ast"
import {Model, Prop, PropType} from "../model"
import {scalars_list} from "../scalars"
import {weakMemo} from "../util"


const baseSchema = buildASTSchema(gql(`
    directive @entity on OBJECT
    directive @derivedFrom(field: String!) on FIELD_DEFINITION
    directive @unique on FIELD_DEFINITION
    directive @fulltext(query: String!) on FIELD_DEFINITION
    directive @variant on OBJECT # legacy
    ${scalars_list.map(name => 'scalar ' + name).join('\n')}
`))


export function buildSchema(doc: DocumentNode): GraphQLSchema {
    return extendSchema(baseSchema, doc)
}


export const getModel = weakMemo(buildModel)


export function buildModel(schema: GraphQLSchema): Model {
    let types = schema.getTypeMap()
    let model: Model = {}
    for (let key in types) {
        let type = types[key]
        if (isEntityType(type)) {
            addEntityOrJsonObject(model, type as GraphQLObjectType)
        }
    }
    validateUnionTypes(model)
    return model
}


function isEntityType(type: GraphQLNamedType): boolean {
    return type instanceof GraphQLObjectType && !!type.astNode?.directives?.some(d => d.name.value == 'entity')
}


function addEntityOrJsonObject(model: Model, type: GraphQLObjectType): void {
    if (model[type.name]) return
    let kind: 'entity' | 'object' = isEntityType(type) ? 'entity' : 'object'
    let properties: Record<string, Prop> = {}
    let fields = type.getFields()

    if (kind == 'entity') {
        if (fields.id == null) {
            properties.id = {
                type: {kind: 'scalar', name: 'ID'},
                nullable: false
            }
        } else {
            let correctIdType = fields.id.type instanceof GraphQLNonNull
                && fields.id.type.ofType instanceof GraphQLScalarType
                && fields.id.type.ofType.name === 'ID'
            if (!correctIdType) {
                throw unsupportedFieldError(type.name, 'id')
            }
        }
    }

    for (let key in fields) {
        let f: GraphQLField<any, any> = fields[key]
        let fieldType = f.type
        let nullable = true
        if (fieldType instanceof GraphQLNonNull) {
            nullable = false
            fieldType = fieldType.ofType
        }
        let list = unwrapList(fieldType)
        fieldType = list.item
        if (fieldType instanceof GraphQLScalarType) {
            properties[key] = {
                type: wrapWithList(list.nulls, {
                    kind: 'scalar',
                    name: fieldType.name
                }),
                nullable
            }
        } else if (fieldType instanceof GraphQLEnumType) {
            addEnum(model, fieldType)
            properties[key] = {
                type: wrapWithList(list.nulls, {
                    kind: 'enum',
                    name: fieldType.name
                }),
                nullable
            }
        } else if (fieldType instanceof GraphQLUnionType) {
            addUnion(model, fieldType)
            properties[key] = {
                type: wrapWithList(list.nulls, {
                    kind: 'union',
                    name: fieldType.name
                }),
                nullable
            }
        } else if (fieldType instanceof GraphQLObjectType) {
            if (isEntityType(fieldType)) {
                switch(list.nulls.length) {
                    case 0:
                        properties[key] = {
                            type: {
                                kind: 'fk',
                                foreignEntity: fieldType.name
                            },
                            nullable
                        }
                        break
                    case 1:
                        let derivedFrom: DirectiveNode | undefined = f.astNode?.directives?.find(d => d.name.value == 'derivedFrom')
                        if (derivedFrom == null) {
                            throw new Error(`@derivedFrom directive is required on ${type.name}.${key} declaration`)
                        }
                        let derivedFromValueNode = derivedFrom.arguments?.[0].value
                        assert(derivedFromValueNode != null)
                        assert(derivedFromValueNode.kind == 'StringValue')
                        properties[key] = {
                            type: {
                                kind: 'list-relation',
                                entity: fieldType.name,
                                field: derivedFromValueNode.value
                            },
                            nullable: false
                        }
                        break
                    default:
                        throw unsupportedFieldError(type.name, key)
                }
            } else {
                addEntityOrJsonObject(model, fieldType)
                properties[key] = {
                    type: wrapWithList(list.nulls, {
                        kind: 'object',
                        name: fieldType.name
                    }),
                    nullable
                }
            }
        } else {
            throw unsupportedFieldError(type.name, key)
        }
    }
    model[type.name] = {
        kind,
        properties
    }
}


function addUnion(model: Model, type: GraphQLUnionType): void {
    if (model[type.name]) return
    let variants: string[] = []
    type.getTypes().forEach(obj => {
        if (isEntityType(obj)) {
            throw new Error(`union ${type.name} has entity ${obj.name} as a variant. Entities in union types are not supported`)
        }
        addEntityOrJsonObject(model, obj)
        variants.push(obj.name)
    })
    model[type.name] = {
        kind: 'union',
        variants
    }
}


function addEnum(model: Model, type: GraphQLEnumType): void {
    if (model[type.name]) return
    let values: Record<string, {}> = {}
    type.getValues().forEach(item => {
        values[item.name] = {}
    })
    model[type.name] = {
        kind: 'enum',
        values
    }
}


function unwrapList(type: GraphQLOutputType): DeepList {
    let nulls: boolean[] = []
    while (type instanceof GraphQLList) {
        type = type.ofType
        if (type instanceof GraphQLNonNull) {
            nulls.push(false)
            type = type.ofType
        } else {
            nulls.push(true)
        }
    }
    return {item: type, nulls}
}


interface DeepList {
    item: GraphQLOutputType
    nulls: boolean[]
}


function wrapWithList(nulls: boolean[], dataType: PropType): PropType {
    if (nulls.length == 0) return dataType
    return {
        kind: 'list',
        item: {
            type: wrapWithList(nulls.slice(1), dataType),
            nullable: nulls[0]
        }
    }
}


function unsupportedFieldError(type: string, field: string): Error {
    return new Error(`${type} has a property ${field} of unsupported type`)
}


function validateUnionTypes(model: Model): void {
    for (let key in model) {
        let item = model[key]
        if (item.kind != 'union') continue
        let properties: Record<string, {objectName: string, type: PropType}> = {}
        item.variants.forEach(objectName => {
            let object = model[objectName]
            assert(object.kind == 'object')
            for (let propName in object.properties) {
                let rec = properties[propName]
                if (rec && !propTypeEquals(rec.type, object.properties[propName].type)) {
                    throw new Error(
                        `${rec.objectName} and ${objectName} variants of union ${key} both have property '${propName}', but types of ${rec.objectName}.${propName} and ${objectName}.${propName} are different.`
                    )
                } else {
                    properties[propName] = {objectName, type: object.properties[propName].type}
                }
            }
        })
    }
}


export function propTypeEquals(a: PropType, b: PropType): boolean {
    if (a.kind != b.kind) return false
    if (a.kind == 'list') return propTypeEquals(a.item.type, (b as typeof a).item.type)
    switch(a.kind) {
        case 'fk':
            return a.foreignEntity == (b as typeof a).foreignEntity
        case 'list-relation':
            return a.entity == (b as typeof a).entity && a.field == (b as typeof a).field
        default:
            return a.name == (b as typeof a).name
    }
}
