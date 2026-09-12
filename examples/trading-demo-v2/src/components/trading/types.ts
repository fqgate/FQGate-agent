export type TradingMode = 'ordinary' | 'credit'

export type AccountTabKey =
  | 'trade'
  | 'positions'
  | 'orders'
  | 'trades'
  | 'fund-flows'
  | 'settlements'

export type AccountActionKey = 'ipo' | 'bank-transfer' | 'collateral-transfer'

export interface TradingAccountView {
  accountId: string
  fundAccount: string
  tradingMode: TradingMode
  brokerName?: string
  connected?: boolean
}

export interface AccountAssetItem {
  key: string
  label: string
  value: number | string | null | undefined
  precision?: number
  suffix?: string
  prominent?: boolean
}

export interface UserFacingError {
  message: string
  code?: string
}

export interface AccountTabItem {
  key: AccountTabKey
  label: string
}

export type OperationFieldType = 'text' | 'number' | 'select' | 'password' | 'textarea'
export type OperationFieldValue = string | number | boolean | null | undefined
export type OperationFormValue = Record<string, OperationFieldValue>

export interface OperationOption {
  label: string
  value: string | number
  disabled?: boolean
}

export interface OperationField {
  key: string
  label: string
  type?: OperationFieldType
  placeholder?: string
  description?: string
  required?: boolean
  disabled?: boolean
  options?: OperationOption[]
  min?: number
  max?: number
  step?: number
  precision?: number
}

export type OperationStatus =
  | 'draft'
  | 'submitting'
  | 'not-sent'
  | 'rejected'
  | 'accepted'
  | 'unknown'

export type RecordCellTone = 'normal' | 'gain' | 'loss'
export type TradingRecord = Record<string, unknown>

export interface RecordColumn {
  key: string
  title: string
  width?: number
  align?: 'left' | 'center' | 'right'
  fixed?: 'left' | 'right'
  formatter?: (value: unknown, record: TradingRecord) => string
  tone?: (value: unknown, record: TradingRecord) => RecordCellTone
}

export interface DateRangeValue {
  startDate: string
  endDate: string
}
