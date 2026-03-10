import React, { createContext, useContext, useReducer } from 'react'
import tokens from 'pages/home/modals/chooseToken/mock'

export type Option = {
  id: number
  icon: string
  acronym: string
  token: string
  tokenPrice: string
  address: string
  decimals: number
}

interface State {
  selectedOption1: Option | null
  selectedOption2: Option | null
  inputValue1: string
  inputValue2: string
}

type Action =
  | { type: 'SET_OPTION_1'; payload: Option }
  | { type: 'SET_OPTION_2'; payload: Option }
  | { type: 'SET_INPUT_VALUE_1'; payload: string }
  | { type: 'SET_INPUT_VALUE_2'; payload: string }
  | { type: 'RESET' }

const initialState: State = {
  selectedOption1: tokens[0] || null,
  selectedOption2: null,
  inputValue1: '',
  inputValue2: ''
}

const AppContext = createContext<{
  state: State
  dispatch: React.Dispatch<Action>
}>({
  state: initialState,
  dispatch: () => null
})

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_OPTION_1':
      return { ...state, selectedOption1: action.payload }
    case 'SET_OPTION_2':
      return { ...state, selectedOption2: action.payload }
    case 'SET_INPUT_VALUE_1':
      return { ...state, inputValue1: action.payload }
    case 'SET_INPUT_VALUE_2':
      return { ...state, inputValue2: action.payload }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [state, dispatch] = useReducer(reducer, initialState)

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export const useAppContext = () => useContext(AppContext)
