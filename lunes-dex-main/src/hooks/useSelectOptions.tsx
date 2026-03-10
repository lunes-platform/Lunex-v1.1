import { useAppContext, Option } from '../context/useContext'

const useSelectOptions = () => {
  const { state, dispatch } = useAppContext()

  const selectOptionForFirst = (option: Option) => {
    dispatch({ type: 'SET_OPTION_1', payload: option })
  }

  const selectOptionForSecond = (option: Option) => {
    dispatch({ type: 'SET_OPTION_2', payload: option })
  }

  const setInputValue1 = (value: string) => {
    dispatch({ type: 'SET_INPUT_VALUE_1', payload: value })
  }

  const setInputValue2 = (value: string) => {
    dispatch({ type: 'SET_INPUT_VALUE_2', payload: value })
  }

  const reset = () => {
    dispatch({ type: 'RESET' })
  }

  return {
    selectedOption1: state.selectedOption1,
    selectedOption2: state.selectedOption2,
    inputValue1: state.inputValue1,
    inputValue2: state.inputValue2,
    selectOptionForFirst,
    selectOptionForSecond,
    setInputValue1,
    setInputValue2,
    reset
  }
}

export default useSelectOptions
