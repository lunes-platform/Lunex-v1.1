import React, { ReactNode } from "react"
import * as B from "../../components/bases"
import * as S from "./styles"
import TabBar from "../../pages/home/tabBar"

interface PageLayoutProps {
    children: ReactNode
    /** Width of the main content box. Defaults to 592px (Swap size) */
    maxWidth?: string
    /** Custom TabBar index. Active index defaults to swap/home (1) */
    activeTab?: number
    showTradeSubNav?: boolean
}

const PageLayout: React.FC<PageLayoutProps> = ({
    children,
    maxWidth = "592px",
}) => {
    return (
        <B.Container 
            height="auto" 
            style={{ minHeight: '100vh' }} 
            justify="flex-start" 
            padding="104px 16px 40px" 
            bg="transparent"
        >
            <TabBar />

            <S.GlowBox maxWidth={maxWidth}>
                {children}
            </S.GlowBox>

            <S.PageFooter>
                Lunex: Developed with love on the Lunes blockchain
            </S.PageFooter>
        </B.Container>
    )
}

export default PageLayout
