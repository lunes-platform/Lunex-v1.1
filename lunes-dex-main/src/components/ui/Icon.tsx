import React from 'react'
import { LucideIcon } from 'lucide-react'

interface IconProps {
  icon: LucideIcon
  className?: string
  size?: number | string
  color?: string
}

export const Icon: React.FC<IconProps> = ({ icon: IconComponent, className = '', size = 20, color = 'currentColor' }) => {
  return (
    <IconComponent 
      className={`w-5 h-5 ${className}`} 
      size={size} 
      color={color} 
      strokeWidth={1.5} 
      aria-hidden="true" 
    />
  )
}
