import { useState } from 'react'
import { useAppContext } from 'context/useContext'
//Modals
import Modal from 'components/modal'
import * as S from './styles'
import * as B from 'components/bases'

type ConfirmSwapProps = {
  close: () => void
  confirm: () => void
}

const ConfirmSwap = ({ ...props }: ConfirmSwapProps) => {
  const { state } = useAppContext()
  const [isChecked, setIsChecked] = useState(false)

  return (
    <Modal
      divider
      width="592px"
      closeX={props.close}
      closeExternal={props.close}
      titleModal="Confirm Swap"
      justify="space-around"
    >
      <S.Content>
        <B.Wrapper direction justify="space-between" bg="transparent">
          <B.Paragraph size="24px">
            <img src={state.selectedOption1?.icon} />
            {state.inputValue1}
          </B.Paragraph>
          <B.Paragraph colors={100} weight={700}>
            {state.selectedOption1?.acronym}
            <B.Span margin="0 0 0 8px" size="16px">
              {state.selectedOption1?.token}
            </B.Span>
          </B.Paragraph>
        </B.Wrapper>

        <img src="img/arrow-down2.svg" />

        <B.Wrapper direction justify="space-between" bg="transparent">
          <B.Paragraph colors={100} size="24px">
            <img src={state.selectedOption2?.icon} />
            {state.inputValue2}
          </B.Paragraph>
          <B.Paragraph colors={100} weight={700}>
            {state.selectedOption2?.acronym}
            <B.Span margin="0 0 0 8px" size="16px">
              {state.selectedOption2?.token}
            </B.Span>
          </B.Paragraph>
        </B.Wrapper>
      </S.Content>

      <B.Wrapper bg="transparent" alignItems="flex-start" margin="24px 0">
        <B.Checkbox
          isChecked={isChecked}
          setIsChecked={() => setIsChecked(!isChecked)}
        >
          I accept the updated price
        </B.Checkbox>
        <B.Span textAlign="left" margin="16px 0 0">
          Output is estimated. You will receive at last 0.03 BTC or the
          transaction will revert.
        </B.Span>
      </B.Wrapper>

      <S.BoxDescriptions
        width="107%"
        maxWidth="107%"
        padding="16px"
        margin="auto 0 -16px 0"
      >
        <S.Descriptions>
          <B.Wrapper width="auto" bg="trasnparent" alignItems="flex-start">
            <B.Paragraph colors={100} weight={700}>
              Price
            </B.Paragraph>
            <B.Span>Minumum received</B.Span>
            <B.Span>Price impact</B.Span>
            <B.Span>Liquidity Provider Free</B.Span>
          </B.Wrapper>
          <B.Wrapper width="auto" bg="trasnparent" alignItems="flex-end">
            <B.Paragraph colors={100} weight={700}>
              {state.inputValue1} {state.selectedOption1?.acronym} per{' '}
              {state.selectedOption2?.acronym}
            </B.Paragraph>
            <B.Span>0.000003 BTC</B.Span>
            <B.Span>0.02%</B.Span>
            <B.Span>0.000001 BTC</B.Span>
          </B.Wrapper>
        </S.Descriptions>
        <B.Wrapper
          direction
          bg="transparent"
          justify="flex-end"
          margin="0 0 8px"
        >
          <B.Button
            status="tertiary"
            width="160px"
            margin="0 16px 0 0"
            onClick={props.close}
          >
            Cancel
          </B.Button>
          <B.Button width="160px" disabled={!isChecked} onClick={props.confirm}>
            Confirm Swap
          </B.Button>
        </B.Wrapper>
      </S.BoxDescriptions>
    </Modal>
  )
}

export default ConfirmSwap
