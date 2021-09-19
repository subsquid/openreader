export type Name = string


export type Model = Record<Name, Entity | JsonObject | Union | Enum>


export interface Entity {
    kind: 'entity'
    properties: Record<Name, Prop>
}


export interface JsonObject {
    kind: 'object'
    properties: Record<Name, Prop>
}


export interface Union {
    kind: 'union'
    variants: Name[]
}


export interface Enum {
    kind: 'enum'
    values: Record<string, {}>
}


export interface Prop {
    type: PropType
    nullable: boolean
}


export type PropType =
    ScalarPropType |
    EnumPropType |
    ListPropType |
    ObjectPropType |
    UnionPropType |
    FkPropType |
    ListRelPropType


export interface ScalarPropType {
    kind: 'scalar'
    name: Name
}


export interface EnumPropType {
    kind: 'enum'
    name: Name
}


export interface ObjectPropType {
    kind: 'object'
    name: Name
}


export interface UnionPropType {
    kind: 'union'
    name: Name
}


export interface ListPropType {
    kind: 'list'
    item: Prop
}


export interface FkPropType {
    kind: 'fk'
    foreignEntity: Name
}


export interface ListRelPropType {
    kind: 'list-relation'
    entity: Name
    field: Name
}
