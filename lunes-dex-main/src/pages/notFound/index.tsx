import { Link } from 'react-router-dom'
import styled from 'styled-components'

const NotFound = () => (
  <Container>
    <Code>404</Code>
    <Message>Page not found</Message>
    <Hint>The URL you requested doesn't match any route on this app.</Hint>
    <BackLink to="/">← Back to home</BackLink>
  </Container>
)

const Container = styled.main`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 32px 16px;
  text-align: center;
  gap: 12px;
`

const Code = styled.h1`
  font-size: clamp(72px, 12vw, 128px);
  margin: 0;
  letter-spacing: -0.04em;
  line-height: 1;
`

const Message = styled.p`
  font-size: 22px;
  margin: 0;
  font-weight: 600;
`

const Hint = styled.p`
  font-size: 14px;
  margin: 0 0 20px 0;
  opacity: 0.65;
  max-width: 480px;
`

const BackLink = styled(Link)`
  font-size: 16px;
  text-decoration: none;
  padding: 10px 24px;
  border-radius: 8px;
  border: 1px solid currentColor;
  &:hover {
    opacity: 0.8;
  }
`

export default NotFound
