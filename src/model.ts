export type Name = string


export type Model = Record<Name, Entity>


export interface Entity {
    columns: Record<Name, ColumnType>
    relations: Relations
}


export interface ColumnType {
    graphqlType: string
    nullable?: boolean
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
    nullable: boolean
}
