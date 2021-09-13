export type Name = string


export type Model = Record<Name, Entity | JsonObject | Union | Enum>


export interface Entity {
    kind: 'entity'
    properties: Record<Name, Prop>
    relations: Relations
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


export type PropType = ScalarPropType | EnumPropType | ListPropType | ObjectPropType | UnionPropType


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
    item: PropType
    nullableItem: boolean
}


export type Relations = Record<Name, Relation>


export type Relation = FK_Relation | LIST_Relation


export interface FK_Relation {
    type: 'FK'
    foreignEntity: Name
    nullable: boolean
}


export interface LIST_Relation {
    type: 'LIST'
    entity: Name
    field: Name
}
