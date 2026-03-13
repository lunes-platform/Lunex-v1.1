import React, { useState } from 'react'
import styled from 'styled-components'
import { getTokenLogo, generateIdenticon } from '../../utils/getTokenLogo'

interface TokenIconProps {
  address: string
  symbol?: string
  size?: number
  className?: string
}

const IconImg = styled.img<{ $size: number }>`
  width: ${p => p.$size}px;
  height: ${p => p.$size}px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: #2a2a2c;
`

const TokenIcon: React.FC<TokenIconProps> = ({ address, symbol, size = 24, className }) => {
  const [src, setSrc] = useState(() => getTokenLogo(address, symbol))

  const handleError = () => {
    setSrc(generateIdenticon(address || 'unknown'))
  }

  return (
    <IconImg
      $size={size}
      src={src}
      alt={symbol || address?.slice(0, 6) || 'token'}
      onError={handleError}
      className={className}
    />
  )
}

export default TokenIcon
