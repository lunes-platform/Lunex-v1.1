import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Button, C, H1, Page, grotesk } from 'components/ui/kit'

const NotFound = () => {
  const navigate = useNavigate()
  return (
    <Page $max={560}>
      <Wrap>
        <Code aria-hidden="true">404</Code>
        <Title>This page is off the chain</Title>
        <Copy>
          The link may be broken or the page was moved. Your funds and positions
          are safe.
        </Copy>
        <Actions>
          <Button size="lg" onClick={() => navigate('/swap')}>
            Go to swap
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/')}>
            Home
          </Button>
        </Actions>
      </Wrap>
    </Page>
  )
}

export default NotFound

const Wrap = styled.div`
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
`

const Code = styled.span`
  ${grotesk};
  font-size: 120px;
  font-weight: 700;
  line-height: 1;
  color: ${C.primary};
  letter-spacing: -0.04em;
  @media (max-width: 759px) {
    font-size: 96px;
  }
`

const Title = styled(H1)`
  font-size: 28px;
`

const Copy = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${C.muted};
  line-height: 1.6;
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
`
