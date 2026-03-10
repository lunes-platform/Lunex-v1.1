import React from 'react'
import { useAppContext } from 'context/useContext'
//Modals
import Modal from 'components/modal'
import * as S from './styles'
import * as B from 'components/bases'

type TransactionSubmittedProps = {
  close: () => void
}

const TransactionSubmitted = ({ close }: TransactionSubmittedProps) => {
  const { state } = useAppContext()

  return (
    <Modal
      closeX={close}
      closeExternal={close}
      width="174px"
      justify="space-around"
      iconLeft="/img/confirm.svg"
    >
      <B.SubTitle
        weight={500}
        size="24px"
        margin="-16px 0 16px"
        textAlign="left"
      >
        Swap {state.inputValue1} {state.selectedOption1?.acronym} for{' '}
        {state.inputValue2} {state.selectedOption2?.acronym}
      </B.SubTitle>
      <S.View cursor>
        <img src="/img/export.svg" /> View on Explorer
      </S.View>
    </Modal>
  )
}

export default TransactionSubmitted
