import React from 'react'
import { useAppContext } from 'context/useContext'
//Modals
import Modal from 'components/modal'
import * as S from './styles'
import * as B from 'components/bases'

type WaitingConfirmationProps = {
  close: () => void
}

const WaitingConfirmation = ({ ...props }: WaitingConfirmationProps) => {
  const { state } = useAppContext()

  return (
    <Modal
      loading
      closeX={props.close}
      justify="space-around"
      titleModal="Waiting for confirmation..."
    >
      <B.Wrapper alignItems="flex-start" bg="transparent">
        <B.Paragraph>
          Swapping {state.inputValue1} {state.selectedOption1?.acronym} for{' '}
          {state.inputValue2} {state.selectedOption2?.acronym}
        </B.Paragraph>
        <B.Span margin="24px 0 0">
          Confirm the transaction in your wallet
        </B.Span>
      </B.Wrapper>
    </Modal>
  )
}

export default WaitingConfirmation
