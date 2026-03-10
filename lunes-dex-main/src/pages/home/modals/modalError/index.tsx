import React from 'react'
//Modals
import Modal from 'components/modal'
import * as S from './styles'
import * as B from 'components/bases'

type ModalErrorProps = {
  close: () => void
}

const ModalError = ({ close }: ModalErrorProps) => {
  return (
    <Modal
      closeX={close}
      height="262px"
      justify="space-around"
      iconLeft="img/attention.png"
      titleModal="ATTENTION!"
    >
      <S.View>An unexpected error occurred, please try again later!</S.View>
      <B.Button onClick={close}>I understood</B.Button>
    </Modal>
  )
}

export default ModalError
