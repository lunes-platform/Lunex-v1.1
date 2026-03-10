import React from 'react'
//Modals
import Modal from 'components/modal'
import * as S from './styles'
import * as B from 'components/bases'

type TransactionSubmittedProps = {
  close: () => void
}

const TransactionSubmitted = ({ close }: TransactionSubmittedProps) => {
  return (
    <Modal
      closeX={close}
      height="262px"
      justify="space-around"
      iconLeft="img/transaction.svg"
      titleModal="Transaction submitted"
    >
      <S.View cursor>
        <img src="img/export.svg" /> View on Explorer
      </S.View>
      <B.Button onClick={close}>Close and wait in explorer</B.Button>
    </Modal>
  )
}

export default TransactionSubmitted
