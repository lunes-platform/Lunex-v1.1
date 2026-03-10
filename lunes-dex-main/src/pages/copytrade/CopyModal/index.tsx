import React, { useEffect, useState } from 'react'
import Modal from 'components/modal'
import * as S from './styles'
import { useSDK } from '../../../context/SDKContext'
import socialApi, {
    buildCopytradeDepositMessage,
    createSignedActionMetadata,
} from '../../../services/socialService'

interface Trader {
    id: string
    name: string
    fee: number
    isAI: boolean
    collateralToken?: string
    minDeposit?: number
}

interface CopyModalProps {
    trader: Trader | null
    onClose: () => void
    onConfirm: (amount: string) => void | Promise<void>
}

const CopyModal: React.FC<CopyModalProps> = ({ trader, onClose, onConfirm }) => {
    const [amount, setAmount] = useState('')
    const [step, setStep] = useState<1 | 2>(1)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const { walletAddress, connectWallet, signMessage } = useSDK()

    useEffect(() => {
        setAmount('')
        setStep(1)
        setLoading(false)
        setError('')
    }, [trader?.id])

    if (!trader) return null

    const token = trader.collateralToken ?? 'USDT'
    const minDeposit = trader.minDeposit ?? 0

    const handleAction = async () => {
        if (!amount || Number(amount) <= 0) return
        if (minDeposit > 0 && Number(amount) < minDeposit) {
            setError(`Minimum deposit is ${String(minDeposit)} ${token}`)
            return
        }

        if (!walletAddress) {
            try {
                await connectWallet()
                setError('Wallet connected. Click again to continue.')
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to connect wallet')
            }
            return
        }

        setError('')
        setLoading(true)

        try {
            if (step === 1) {
                await new Promise((resolve) => setTimeout(resolve, 600))
                setStep(2)
                return
            }

            const auth = createSignedActionMetadata()
            const signature = await signMessage(buildCopytradeDepositMessage({
                leaderId: trader.id,
                followerAddress: walletAddress,
                token,
                amount,
                nonce: auth.nonce,
                timestamp: auth.timestamp,
            }))

            await socialApi.depositToVault(trader.id, {
                followerAddress: walletAddress,
                token,
                amount,
                nonce: auth.nonce,
                timestamp: auth.timestamp,
                signature,
            })

            await onConfirm(amount)
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to deposit into vault')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal
            divider
            width="520px"
            justify="space-between"
            closeX={onClose}
            closeExternal={onClose}
            titleModal="Copy Trader Vault"
            description="Review the leader terms and choose how much you want to allocate to this vault."
        >
            <S.ContentArea>
                <S.LeaderCard>
                    <S.InfoRow>
                        <span>Target Leader</span>
                        <strong>{trader.isAI ? '🤖 ' : ''}{trader.name}</strong>
                    </S.InfoRow>
                    <S.InfoRow>
                        <span>Performance Fee (HWM)</span>
                        <S.AccentValue>{trader.fee}% on Profits</S.AccentValue>
                    </S.InfoRow>
                    <S.InfoRow>
                        <span>Minimum Deposit</span>
                        <strong>{String(minDeposit || 0)} {token}</strong>
                    </S.InfoRow>
                    <S.InfoRow>
                        <span>Network</span>
                        <strong>Lunes Network</strong>
                    </S.InfoRow>
                </S.LeaderCard>

                <S.Label>Amount to Deposit</S.Label>
                <S.InputHint>Enter the amount you want this leader to manage on your behalf.</S.InputHint>
                <S.InputWrapper>
                    <S.Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                    <S.CurrencyLabel>{token}</S.CurrencyLabel>
                </S.InputWrapper>

                <S.BalanceInfo>
                    <span>Balance is validated by your connected wallet and backend checks during deposit.</span>
                </S.BalanceInfo>

                <S.WarningBox>
                    <p>
                        By depositing funds, this Trader/AI will automatically execute trades on your behalf.
                        The leader takes a {trader.fee}% fee <b>only</b> on positive net profits. You can withdraw at any time.
                    </p>
                </S.WarningBox>

                {error ? <S.ErrorBox>{error}</S.ErrorBox> : null}

                <S.Actions>
                    <S.Button onClick={onClose}>Cancel</S.Button>
                    <S.Button
                        primary
                        disabled={!amount || Number(amount) <= 0 || loading || Number(amount) < minDeposit}
                        onClick={handleAction}
                    >
                        {loading ? 'Processing...' : !walletAddress ? 'Connect Wallet' : step === 1 ? `Approve ${token}` : 'Deposit in Vault'}
                    </S.Button>
                </S.Actions>

            </S.ContentArea>
        </Modal>
    )
}

export default CopyModal
