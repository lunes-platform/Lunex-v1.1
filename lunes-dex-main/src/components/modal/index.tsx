import { HtmlHTMLAttributes, ReactNode } from 'react'
//Styles
import * as B from 'components/bases'
import * as S from './styles'

export type ModalProps = {
  children: ReactNode
  width: string
  height: string
  justify: string
  direction: boolean
  titleModal: string | boolean
  description: string | boolean
  loading: boolean
  divider: boolean
  arrowLeft: boolean
  iconLeft: string
  closeX: () => void
  closeExternal: () => void
} & HtmlHTMLAttributes<HTMLElement>
/**
### Typagens disponíveis
- width: string
- height: string
- justify: string
- direction: boolean/ se ativo padrão será row
- titleModal: string | boolean
- description: string | boolean
- loading: boolean
- divider: boolean
- arrowLeft: boolean
- iconLeft: string
- closeX: ()=>void
- closeExternal: ()=>void
### Have fun and be happy!
*/
const Modal = ({ children, loading, ...props }: Partial<ModalProps>) => {
  return (
    <S.Container>
      <S.CloseExternal onClick={props.closeExternal} {...props} />
      <S.Content {...props}>
        {!props.arrowLeft && <S.Close onClick={props.closeX}>✕</S.Close>}
        <B.Wrapper
          bg="transparent"
          alignItems={props.arrowLeft ? 'center' : 'flex-start'}
        >
          <S.Icon
            padding={!props.arrowLeft}
            onClick={props.arrowLeft ? props.closeX : undefined}
            src={props.arrowLeft ? 'img/arrow-left.svg' : props.iconLeft}
          />
          {loading && <B.Loading purple />}
          <B.SubTitle
            weight={400}
            margin={props.iconLeft ? '48px 0 16px' : '16px 0'}
          >
            {props.titleModal}
          </B.SubTitle>
          {props.description && (
            <B.Paragraph margin="0 0 20px">{props.description}</B.Paragraph>
          )}
          {props.divider && <S.Divider />}
        </B.Wrapper>
        {children}
      </S.Content>
    </S.Container>
  )
}

export default Modal
