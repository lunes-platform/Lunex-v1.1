import React from 'react'
//Modals
import Modal from 'components/modal'
import * as S from './styles'

type ConnectingProps = {
  close: () => void
}

const Connecting = ({ close }: ConnectingProps) => {
  return (
    <Modal
      loading
      divider
      closeX={close}
      width="488px"
      justify="space-around"
      titleModal="Connecting..."
    >
      <S.Content
        radius
        width="auto"
        height="128px"
        margin="20px"
        padding="20px"
      >
        <S.Description>
          By connecting a wallet, you agreen to Lunes
          <strong> Terms of Service</strong> and acknowledge that you have read
          and understant the<strong> Lunes Protocol Disclaimer</strong>.
        </S.Description>
      </S.Content>
    </Modal>
  )
}

export default Connecting
