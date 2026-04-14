import React, { useState } from 'react'
//Styles
import * as S from './styles'
import * as B from 'components/bases'
//Modal
import Modal from 'components/modal'
//Mocks
import slippageTolerance from './mock'

export type TransactionSettingProps = {
  close: () => void
  onSave: (slippage: number, deadlineMinutes: number) => void
  currentSlippage?: number
  currentDeadline?: number
}

const InfoIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

const TransactionSetting = ({
  close,
  onSave,
  currentSlippage = 0.5,
  currentDeadline = 20
}: TransactionSettingProps) => {
  const [selectedId, setSelectedId] = useState(() => {
    const match = slippageTolerance.find(s => s.value === currentSlippage)
    return match ? match.id : 3 // default to "Auto"
  })
  const [deadline, setDeadline] = useState(currentDeadline)

  const selectedOption =
    slippageTolerance.find(s => s.id === selectedId) || slippageTolerance[3]

  const handleSelectSlippage = (item: (typeof slippageTolerance)[0]) => {
    setSelectedId(item.id)
    setDeadline(item.deadlineMinutes)
  }

  const handleSave = () => {
    onSave(selectedOption.value, deadline)
  }

  return (
    <Modal
      width="592px"
      height="386px"
      justify="space-between"
      closeX={close}
      closeExternal={close}
      arrowLeft
      titleModal="Transaction Setting"
    >
      <S.LabelRow>
        <B.Paragraph weight={700} colors={100} margin="0">
          Slippage tolerance
        </B.Paragraph>
        <S.InfoWrapper>
          <InfoIcon />
          <S.TooltipText>
            Your transaction will revert if the price changes unfavorably by
            more than this percentage. Higher slippage = more likely to succeed,
            but less price protection.
          </S.TooltipText>
        </S.InfoWrapper>
      </S.LabelRow>

      <S.Content>
        {slippageTolerance.map(item => {
          return (
            <B.Button
              key={item.id}
              status={item.id === selectedId ? 'default' : 'transparent'}
              onClick={() => handleSelectSlippage(item)}
            >
              {item.percentage}
            </B.Button>
          )
        })}
      </S.Content>

      <S.LabelRow style={{ marginTop: '4px', marginBottom: '0' }}>
        <B.Paragraph weight={700} colors={100} margin="0">
          Transaction deadline
        </B.Paragraph>
        <S.InfoWrapper>
          <InfoIcon />
          <S.TooltipText>
            Maximum time (in minutes) your transaction can remain pending before
            it is automatically cancelled. Auto-synced when you select a
            slippage preset.
          </S.TooltipText>
        </S.InfoWrapper>
      </S.LabelRow>

      <B.Input
        type="number"
        inputName=""
        placeholder="Minutes"
        value={String(deadline)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const v = parseInt(e.target.value, 10)
          if (!isNaN(v) && v > 0) setDeadline(v)
        }}
      />

      <B.Wrapper direction bg="transparent" justify="flex-end" margin="0 0 8px">
        <B.Button
          status="tertiary"
          width="160px"
          margin="0 16px 0 0"
          onClick={close}
        >
          Cancel
        </B.Button>
        <B.Button width="160px" onClick={handleSave}>
          Save
        </B.Button>
      </B.Wrapper>
    </Modal>
  )
}

export default TransactionSetting
