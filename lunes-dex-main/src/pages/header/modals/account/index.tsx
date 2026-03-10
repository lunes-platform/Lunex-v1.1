import React, { useEffect, useState, useCallback } from 'react'
import { useAppContext } from 'context/useContext'
//Modals
import Modal from 'components/modal'
import * as B from 'components/bases'
import useSelectOptions from 'hooks/useSelectOptions'
import { useNavigate } from 'react-router-dom'
import { useSDK } from '../../../../context/SDKContext'
import * as S from './styles'

type AccountProps = {
  close: () => void
  disconnect: () => void
  change: () => void
  statusTransaction: () => void
}

const Account = ({ ...props }: AccountProps) => {
  const navigate = useNavigate()
  const { state } = useAppContext()
  const { reset } = useSelectOptions()
  const { walletAddress } = useSDK()
  const [status, setStatus] = useState(0) //0 no transaction/1 pending/ 2 complete
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [walletAddress])

  const formattedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : 'Wallet not connected'

  useEffect(() => {
    if (!!state.selectedOption1 && !!state.selectedOption2) {
      setStatus(1)
    }
  }, [])

  const recentTransaction = () => {
    if (status === 1) {
      props.statusTransaction()
    }
  }

  setTimeout(() => {
    // para efeitos visuais
    // if (status === 0) {
    //   setStatus(1)
    // }
    if (status === 1) {
      reset()
      setStatus(2)
    }
    if (status === 2) {
      setStatus(0)
    }
    // if (status === 1) {
    //   setStatus(0)
    //   props.statusTransaction()
    // }
  }, 7000)

  return (
    <Modal
      divider
      width="592px"
      closeX={props.close}
      closeExternal={props.close}
      titleModal="Account"
      justify="space-around"
    >
      <S.Content>
        <B.Wrapper direction justify="space-between" bg="transparent">
          <B.Paragraph margin="0 auto 0 0">
            Connected with Lunes Wallet
          </B.Paragraph>
          <B.Button status="secondary" onClick={props.disconnect}>
            Disconnect
          </B.Button>
          <B.Button onClick={props.change}>Change</B.Button>
        </B.Wrapper>

        <S.Address colors={100} size="24px" weight={500}>
          {formattedAddress}
        </S.Address>

        <S.LinkBox direction justify="flex-start" bg="transparent">
          <B.Span cursor onClick={handleCopy}>
            <img src="/img/copy.svg" /> {copied ? 'Copied!' : 'Copy Address'}
          </B.Span>
          <B.Span cursor margin="0 16px 0">
            <img src="/img/export.svg" /> View on Explorer
          </B.Span>
          <B.Span
            cursor
            onClick={() => {
              props.close()
              navigate('/social/settings')
            }}
            style={{ color: '#AD87FF', border: '1px solid #AD87FF', padding: '4px 12px', borderRadius: '6px' }}
          >
            My Social Profile
          </B.Span>
        </S.LinkBox>
      </S.Content>

      <S.BoxTransaction
        width="107%"
        padding="32px"
        maxWidth="107%"
        alignItems="flex-start"
        margin="auto 0 -16px 0"
      >
        <B.Paragraph colors={100}>
          {status === 0
            ? 'Yout transactions will appear here...'
            : 'Recent transaction'}
        </B.Paragraph>

        {status != 0 && (
          <S.Status direction status={status === 1}>
            <B.Paragraph cursor>
              Swap {state.inputValue1} {state.selectedOption1?.acronym} for{' '}
              {state.inputValue2} {state.selectedOption2?.acronym}{' '}
              <img src="/img/export.svg" />
            </B.Paragraph>
            <B.Span onClick={recentTransaction}>
              {status === 1 ? 'Pending' : 'Complete'}
            </B.Span>
          </S.Status>
        )}
      </S.BoxTransaction>
    </Modal>
  )
}

export default Account
