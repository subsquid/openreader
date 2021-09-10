import {
    buildASTSchema,
    DocumentNode,
    extendSchema, GraphQLField, GraphQLList,
    GraphQLNamedType,
    GraphQLNonNull,
    GraphQLObjectType, GraphQLScalarType,
    GraphQLSchema
} from "graphql"
import {DirectiveNode} from "graphql/language/ast"
import {gql} from "apollo-server"
import assert from "assert"
import {ColumnType, Entity, Model, Relations} from "../model"
import {scalars_list} from "../scalars"
import {weakMemo} from "../util"


const baseSchema = buildASTSchema(gql(`
    directive @entity on OBJECT | INTERFACE
    directive @derivedFrom(field: String!) on FIELD_DEFINITION
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
            model[key] = buildEntity(type)
        }
    }
    return model
}


function isEntityType(type: GraphQLNamedType): type is GraphQLObjectType {
    return type instanceof GraphQLObjectType && !!type.astNode?.directives?.some(d => d.name.value == 'entity')
}


function buildEntity(type: GraphQLObjectType): Entity {
    let columns: Record<string, ColumnType> = {}
    let relations: Relations = {}
    let fields = type.getFields()
    for (let key in fields) {
        let f: GraphQLField<any, any> = fields[key]
        let fieldType = f.type
        let isList = false
        let isNullable = true
        if (fieldType instanceof GraphQLNonNull) {
            isNullable = false
            fieldType = fieldType.ofType
        }
        if (fieldType instanceof GraphQLList) {
            isList = true
            fieldType = fieldType.ofType
            if (fieldType instanceof GraphQLNonNull) {
                fieldType = fieldType.ofType
            }
        }
        if (fieldType instanceof GraphQLScalarType) {
            if (isList) throw unsupportedFieldError(type.name, key)
            columns[key] = {
                graphqlType: fieldType.name,
                nullable: isNullable
            }
        } else if (fieldType instanceof GraphQLObjectType) {
            if (!isEntityType(fieldType)) throw unsupportedFieldError(type.name, key)
            if (isList) {
                let derivedFrom: DirectiveNode | undefined = f.astNode?.directives?.find(d => d.name.value == 'derivedFrom')
                if (derivedFrom == null) {
                    throw new Error(`@derivedFrom directive is required on ${type.name}.${key} declaration`)
                }
                let derivedFromValueNode = derivedFrom.arguments?.[0].value
                assert(derivedFromValueNode != null)
                assert(derivedFromValueNode.kind == 'StringValue')
                relations[key] = {
                    type: 'LIST',
                    entity: fieldType.name,
                    field: derivedFromValueNode.value,
                    nullable: isNullable
                }
            } else {
                relations[key] = {
                    type: 'FK',
                    foreignEntity: fieldType.name,
                    nullable: isNullable
                }
            }
        } else {
            throw unsupportedFieldError(type.name, key)
        }
    }
    return {columns, relations}
}


function unsupportedFieldError(type: string, field: string): Error {
    return new Error(`${type} has a property ${field} of unsupported type`)
}


// console.log(JSON.stringify(buildModel(buildSchema(gql`
//     type Account @entity {
//         id: ID!
//         contributions: [Contribution!] @derivedFrom(field: "account")
//     }
//     type Contribution @entity {
//         id: ID!
//         account: Account!
//         balance: Int!
//     }
//     type Query {
//         accounts: [Account!]!
//         contributions: [Contribution!]!
//     }
// `)), null, 2))
