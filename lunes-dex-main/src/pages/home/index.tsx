import React, { useEffect, useState, useCallback } from 'react'
import * as B from 'components/bases'
import * as S from './styles'
import { Tooltip } from 'components/bases/tooltip'
import TabBar from './tabBar'
import FooterTag from 'components/FooterTag'
import TradeSubNav from '../../components/tradeSubNav'
//Modals
import * as M from './modals'
//Mocks
import tokens from './modals/chooseToken/mock'
import useSelectOptions from 'hooks/useSelectOptions'
import { Option } from 'context/useContext'
import { useSDK } from '../../context/SDKContext'

const Home = () => {
  // SDK Integration
  const sdk = useSDK()

  const {
    selectedOption1,
    selectedOption2,
    inputValue1,
    inputValue2,
    setInputValue1,
    setInputValue2,
    selectOptionForFirst,
    selectOptionForSecond
  } = useSelectOptions()
  const [selectingForFirst, setSelectingForFirst] = useState<boolean | null>(
    null
  )
  const [modal, setModal] = useState('null')

  // Estado para integração com SDK
  interface QuoteState {
    amountOut: string
    executionPrice?: string
    priceImpact?: string
    minimumReceived?: string
  }
  const [quote, setQuote] = useState<QuoteState | null>(null)
  const [outputAmount, setOutputAmount] = useState('')
  const [priceImpact, setPriceImpact] = useState('0')
  const [minimumReceived, setMinimumReceived] = useState('0')
  const [tokenBalances, setTokenBalances] = useState<{ [key: string]: string }>(
    {}
  )
  const [slippage, setSlippage] = useState(0.5) // 0.5% default
  const [deadline, setDeadline] = useState(20) // 20 minutes default

  const handleOpenModal = (forFirst: boolean) => {
    setSelectingForFirst(forFirst)
    setModal('chooseToken')
  }

  const handleSelectOption = (option: Option) => {
    if (selectingForFirst) {
      selectOptionForFirst(option)
    } else {
      selectOptionForSecond(option)
    }
    setModal('null')
  }

  // Buscar quote quando mudar o input
  const fetchQuote = useCallback(async () => {
    if (
      !selectedOption1?.address ||
      !selectedOption2?.address ||
      !inputValue1 ||
      inputValue1 === '0'
    ) {
      setQuote(null)
      setOutputAmount('')
      return
    }

    try {
      const decimals = selectedOption1.decimals || 8
      const amountInWei = sdk.parseAmount(inputValue1, decimals)

      const quoteResult = await sdk.getQuote(amountInWei, [
        selectedOption1.address,
        selectedOption2.address
      ])

      if (quoteResult) {
        setQuote(quoteResult)
        const outputDecimals = selectedOption2.decimals || 8
        setOutputAmount(sdk.formatAmount(quoteResult.amountOut, outputDecimals))
        setPriceImpact(quoteResult.priceImpact || '0')
        setMinimumReceived(
          sdk.formatAmount(quoteResult.minimumReceived, outputDecimals)
        )
        setInputValue2(sdk.formatAmount(quoteResult.amountOut, outputDecimals))
      }
    } catch (error) {
      console.error('Erro ao buscar quote:', error)
    }
  }, [selectedOption1, selectedOption2, inputValue1, sdk, setInputValue2])

  // Debounce para buscar quote
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchQuote()
    }, 500)
    return () => clearTimeout(timer)
  }, [inputValue1, selectedOption1, selectedOption2])

  // Buscar balances quando conectar wallet
  useEffect(() => {
    const fetchBalances = async () => {
      if (!sdk.walletAddress) return

      const balances: { [key: string]: string } = {}
      for (const token of tokens) {
        if (token.address) {
          const balance = await sdk.getTokenBalance(
            token.address,
            sdk.walletAddress
          )
          balances[token.address] = sdk.formatAmount(
            balance,
            token.decimals || 8
          )
        }
      }
      setTokenBalances(balances)
    }

    fetchBalances()
  }, [sdk.walletAddress, sdk])

  // Handler para executar swap
  const handleConfirmSwap = async () => {
    if (!sdk.walletAddress) {
      sdk.connectWallet()
      return
    }

    if (
      !selectedOption1?.address ||
      !selectedOption2?.address ||
      !inputValue1 ||
      !quote
    ) {
      return
    }

    setModal('waitingConfirmation')

    try {
      const decimals = selectedOption1.decimals || 8
      const amountInWei = sdk.parseAmount(inputValue1, decimals)
      const amountOutMinWei = sdk.calculateMinAmount(quote.amountOut, slippage)
      const deadlineTs = sdk.calculateDeadline(deadline)

      const success = await sdk.executeSwap({
        amountIn: amountInWei,
        amountOutMin: amountOutMinWei,
        path: [selectedOption1.address, selectedOption2.address],
        to: sdk.walletAddress,
        deadline: deadlineTs
      })

      if (success) {
        setModal('transactionSubmitted')
        // Limpar campos
        setInputValue1('')
        setInputValue2('')
        setQuote(null)
        setOutputAmount('')
      } else {
        setModal('modalError')
      }
    } catch (error) {
      console.error('Erro ao executar swap:', error)
      setModal('modalError')
    }
  }

  // Handler para salvar slippage e deadline
  const handleSaveSettings = (newSlippage: number, newDeadline: number) => {
    setSlippage(newSlippage)
    setDeadline(newDeadline)
    setModal('null')
  }

  return (
    <B.Container height="100vh" padding="80px 8px">
      <TabBar />

      <S.Box
        width="592px"
        minHeight="448px"
        padding="0 24px 24px"
        justify="space-between"
        bg={500}
        radius
        shadow
      >
        <TradeSubNav
          active="swap"
          onSettingsClick={() => setModal('transactionSetting')}
        />

        <S.Content>
          <B.Wrapper radius position="relative">
            <S.Details inset="16px auto auto 16px">From</S.Details>
            <S.Details inset="16px 16px auto auto" active>
              Balance:{' '}
              {selectedOption1?.address
                ? tokenBalances[selectedOption1.address] || '0'
                : '0'}
            </S.Details>
            <B.Input
              placeholder="0"
              height="112px"
              sizeInput="24px"
              disabled={!selectedOption1}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setInputValue1(e.target.value)
              }
              value={inputValue1}
            />
            <S.Token
              isToken={!selectedOption1}
              onClick={() => handleOpenModal(true)}
            >
              <img src={selectedOption1?.icon} />
              {selectedOption1?.acronym || 'Select a token'}
              <img src="img/arrow-down.svg" />
            </S.Token>
          </B.Wrapper>

          <img src="img/from-token.svg" />

          <B.Wrapper radius position="relative">
            <S.Details inset="16px auto auto 16px">To (Estimated)</S.Details>
            <S.Details inset="16px 16px auto auto" active>
              Balance:{' '}
              {selectedOption2?.address
                ? tokenBalances[selectedOption2.address] || '0'
                : '0'}
            </S.Details>
            <B.Input
              placeholder="0"
              height="112px"
              sizeInput="24px"
              disabled={!selectedOption2}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setInputValue2(e.target.value)
              }
              value={outputAmount || inputValue2}
            />
            {selectedOption1 && selectedOption2 && quote && (
              <S.Details inset="auto auto 16px 16px" active size="14px">
                {sdk.isLoading ? (
                  'Loading...'
                ) : (
                  <>
                    $ {quote.executionPrice || '0.00'}
                    <strong
                      style={{
                        color: Number(priceImpact) > 1 ? '#ff6b6b' : '#26d07c'
                      }}
                    >
                      {' '}
                      ({Number(priceImpact) > 0 ? '-' : '+'} {priceImpact}%)
                    </strong>
                  </>
                )}
              </S.Details>
            )}
            <S.Token
              isToken={!selectedOption2}
              onClick={() => handleOpenModal(false)}
            >
              <img src={selectedOption2?.icon} />
              {selectedOption2?.acronym || 'Select a token'}
              <img src="img/arrow-down.svg" />
            </S.Token>
          </B.Wrapper>
        </S.Content>

        <S.Descriptions
          display={
            selectedOption1 && selectedOption2 && quote ? 'flex' : 'none'
          }
        >
          <B.Wrapper width="auto" bg="trasnparent" alignItems="flex-start">
            <p>Price</p>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              Minimum received
              <Tooltip
                content={`A quantia mínima garantida que você receberá. Se o preço mudar desfavoravelmente acima do Slippage (${slippage}%), a transação reverterá.`}
                position="right"
              />
            </span>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              Price impact
              <Tooltip
                content="A estimativa de perda gerada pelo tamanho da sua ordem em relação à liquidez disponível da Pool."
                position="right"
              />
            </span>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              Protocol Fee
              <Tooltip
                content="0.5% total: 0.4% para provedores de liquidez, 0.05% para o protocolo (time) e 0.05% para stakers de LUNES."
                position="right"
              />
            </span>
          </B.Wrapper>
          <B.Wrapper width="auto" bg="trasnparent" alignItems="flex-end">
            <p>
              1 {selectedOption1?.acronym} = {quote?.executionPrice || '0'}{' '}
              {selectedOption2?.acronym}
            </p>
            <span>
              {minimumReceived} {selectedOption2?.acronym}
            </span>
            <span
              style={{ color: Number(priceImpact) > 1 ? '#ff6b6b' : '#26d07c' }}
            >
              {priceImpact}%
            </span>
            <span>0.4% LP + 0.05% Protocolo + 0.05% Stakers</span>
          </B.Wrapper>
        </S.Descriptions>

        {/* Loading indicator */}
        {sdk.isLoading && (
          <S.Paragraph style={{ textAlign: 'center', color: '#8a8a8e' }}>
            Loading...
          </S.Paragraph>
        )}

        {/* Error message */}
        {sdk.error && (
          <S.Paragraph style={{ textAlign: 'center', color: '#ff6b6b' }}>
            {sdk.error}
          </S.Paragraph>
        )}

        <B.Button
          disabled={
            sdk.isConnected &&
            (sdk.isLoading ||
              (!selectedOption1?.id && !selectedOption2?.id) ||
              inputValue1.length < 1 ||
              !quote)
          }
          onClick={
            sdk.isConnected ? handleConfirmSwap : () => sdk.connectWallet()
          }
        >
          {!sdk.isConnected
            ? 'Connect Wallet'
            : !selectedOption1?.id && !selectedOption2?.id
              ? 'Select a token'
              : inputValue1.length < 1
                ? 'Enter an amount'
                : !quote
                  ? 'Loading quote...'
                  : 'Swap tokens'}
        </B.Button>
      </S.Box>
      <FooterTag />

      {modal === 'chooseToken' && (
        <M.ChooseToken
          tokens={tokens}
          onSelect={handleSelectOption}
          close={() => setModal('null')}
        />
      )}

      {modal === 'waitingConfirmation' && (
        <M.WaitingConfirmation close={() => setModal('null')} />
      )}

      {modal === 'transactionSubmitted' && (
        <M.TransactionSubmitted close={() => setModal('modalError')} />
      )}

      {modal === 'confirmSwap' && (
        <M.ConfirmSwap
          close={() => setModal('null')}
          confirm={() => setModal('waitingConfirmation')}
        />
      )}

      {modal === 'transactionSetting' && (
        <M.TransactionSetting
          close={() => setModal('null')}
          onSave={handleSaveSettings}
          currentSlippage={slippage}
          currentDeadline={deadline}
        />
      )}

      {modal === 'modalError' && (
        <M.ModalError close={() => setModal('null')} />
      )}
    </B.Container>
  )
}

export default Home
