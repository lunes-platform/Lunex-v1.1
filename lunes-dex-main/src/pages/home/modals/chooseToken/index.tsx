import { useState } from 'react'
//Styles
import * as S from './styles'
import * as B from 'components/bases'
//Modal
import Modal from 'components/modal'
import TokenIcon from 'components/TokenIcon'

export type TokensItems = {
  id: number
  icon: string
  acronym: string
  token: string
  tokenPrice: string
  address: string
  decimals: number
}

export type ChooseTokenProps = {
  close: () => void
  tokens: TokensItems[]
  onSelect: (token: TokensItems) => void
}

const ChooseToken = ({ close, onSelect, tokens }: ChooseTokenProps) => {
  const [searchToken, setSearchToken] = useState('')
  // console.log('token', token)

  const searchItems = tokens.filter(
    i =>
      i.token.toLowerCase().indexOf(searchToken?.toLowerCase()) !== -1 ||
      i.acronym.toLowerCase().indexOf(searchToken?.toLowerCase()) !== -1
  )

  return (
    <Modal
      width="592px"
      height="468px"
      justify="flex-start"
      closeX={close}
      // closeExternal={close}
      titleModal="Choose token"
      iconLeft="img/arrow-left.svg"
      arrowLeft
    >
      <B.Input
        inputName="Search by symbol or name"
        placeholder="Search token"
        iconRight="img/search.svg"
        type="search"
        onChange={e => setSearchToken(e.target.value)}
        value={searchToken}
      />
      <S.Content bg="transparent">
        <B.Paragraph size="14px">Token</B.Paragraph>
        <B.Paragraph size="14px">Token price</B.Paragraph>
      </S.Content>

      <S.BoxTokens bg="transparent">
        {searchItems.map(item => {
          return (
            <S.Content
              bg="transparent"
              key={item?.id}
              onClick={() => {
                close()
                onSelect(item)
              }}
            >
              <B.Paragraph colors={100} weight={700}>
                {item.icon ? (
                  <img src={item.icon} />
                ) : (
                  <TokenIcon
                    address={item.address}
                    symbol={item.acronym}
                    size={24}
                  />
                )}
                {item.acronym}
                <B.Span margin="0 0 0 8px" size="14px">
                  {item.token}
                </B.Span>
              </B.Paragraph>
              <B.Paragraph colors={100}>{item.tokenPrice}8787</B.Paragraph>
              <img src="img/arrow-right.svg" />
            </S.Content>
          )
        })}
      </S.BoxTokens>
    </Modal>
  )
}

export default ChooseToken
