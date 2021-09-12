
export type WhereOp =
    'eq' | 'not_eq' |
    'gt' |
    'gte' |
    'lt' |
    'lte' |
    'in' | 'not_in' |
    'contains' | 'not_contains' |
    'starts_with' | 'not_starts_with' |
    'ends_with' | 'not_ends_with' |
    'some' |
    'every' |
    'none'


const ENDINGS = [
    'not',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'not_in',
    'contains',
    'not_contains',
    'starts_with',
    'not_starts_with',
    'ends_with',
    'not_ends_with',
    'some',
    'every',
    'none'
]


const OPS_REGEX = new RegExp(`^(.*)_(${ENDINGS.join('|')})$`)


export function parseWhereField(field: string): {op: WhereOp, field: string} {
    let m = OPS_REGEX.exec(field)
    if (!m) return {op: 'eq', field}
    if (m[2] == 'not') return {
        op: 'not_eq',
        field: m[1]
    }
    return {
        op: m[2] as WhereOp,
        field: m[1]
    }
}


export function hasConditions(where?: any): where is any {
    if (where == null) return false
    for (let key in where) {
        switch(key) {
            case 'AND':
            case 'OR':
                break
            default:
                return true
        }
    }
    if (Array.isArray(where.AND)) {
        if (where.AND.some(hasConditions)) return true
    } else if (where.AND && hasConditions(where.AND)) {
        return true
    }
    if (Array.isArray(where.OR)) {
        if (where.OR.some(hasConditions)) return true
    } else if (where.OR && hasConditions(where.OR)) {
        return true
    }
    return false
}


export function whereOpToSqlOperator(op: WhereOp): string {
    switch(op) {
        case 'eq':
            return '='
        case 'not_eq':
            return '!='
        case 'gt':
            return '>'
        case 'gte':
            return '>='
        case 'lt':
            return '<'
        case 'lte':
            return '<='
        case 'in':
            return 'IN'
        case 'not_in':
            return 'NOT IN'
        default:
            throw new Error(`Operator ${op} doesn't have SQL analog`)
    }
}
