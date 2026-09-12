import type { LoginAccountType, LoginAccountTypeOption, TradingMode } from '~/types'

export interface LoginFormValue {
  tradingMode: TradingMode
  accountType: LoginAccountType
  brokerId: string
  accessPointId: string
  loginAccount: string
  password: string
}

export type { LoginAccountTypeOption, TradingMode }

export interface BrokerOption {
  brokerId: string
  name: string
}

export interface AccessPointOption {
  accessPointId: string
  name: string
  area?: string
  carrier?: string
}

export interface LoginFormError {
  message: string
  code?: string
}
