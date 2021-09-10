
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
    'not_ends_with'
]


const OPS_REGEX = new RegExp(`^(.*)_(${ENDINGS.join('|')})$`)


function endingToOperator(ending: string): string {
    switch(ending) {
        case 'not':
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
            throw new Error('Unsupported operator: ' + ending)
    }
}


export function parseWhereField(field: string): {op: string, field: string} {
    let m = OPS_REGEX.exec(field)
    if (!m) return {op: '=', field}
    return {
        op: endingToOperator(m[2]),
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
    if (where.AND && where.AND.some(hasConditions)) return true
    if (where.OR && where.OR.some(hasConditions)) return true
    return false
}
