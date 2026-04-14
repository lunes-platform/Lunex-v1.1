import React, { useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import PageLayout from '../../components/layout'
import { usePools } from '../../hooks/usePools'
import TokenIcon from '../../components/TokenIcon'

type PoolFilter = 'all' | 'stable' | 'volatile' | 'my_pools'

// Styled Components

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 16px;
`

const HeaderLeft = styled.div``

const Title = styled.h1`
  color: #fff;
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px 0;
`

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 14px;
  margin: 0;
`

const HeaderStats = styled.div`
  display: flex;
  gap: 24px;
`

const StatBox = styled.div`
  text-align: right;
`

const StatLabel = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  margin-bottom: 2px;
`

const StatValue = styled.div`
  color: #fff;
  font-size: 18px;
  font-weight: 700;
`

const FiltersRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
`

const FilterTabs = styled.div`
  display: flex;
  gap: 8px;
`

const FilterTab = styled.button<{ $active: boolean }>`
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid ${props => (props.$active ? '#6c38fe' : 'transparent')};
  background: ${props =>
    props.$active ? '#6c38fe20' : props.theme.colors.themeColors[400]};
  color: ${props =>
    props.$active ? '#fff' : props.theme.colors.themeColors[100]};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #6c38fe;
  }
`

const SearchRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`

const SearchInput = styled.input`
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.themeColors[300]};
  background: ${({ theme }) => theme.colors.themeColors[400]};
  color: #fff;
  font-size: 14px;
  width: 200px;

  &::placeholder {
    color: ${({ theme }) => theme.colors.themeColors[100]};
  }

  &:focus {
    outline: none;
    border-color: #6c38fe;
  }
`

const CreateButton = styled.button`
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: #6c38fe;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`

const TableContainer = styled.div`
  overflow-x: auto;
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`

const TableHead = styled.thead`
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[300]};
`

const TableHeadCell = styled.th<{ $align?: 'left' | 'right' }>`
  padding: 12px 8px;
  text-align: ${props => props.$align || 'left'};
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const TableBody = styled.tbody``

const TableRow = styled.tr`
  border-bottom: 1px solid ${({ theme }) => theme.colors.themeColors[400]};
  transition: background 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.themeColors[400]};
  }

  &:last-child {
    border-bottom: none;
  }
`

const TableCell = styled.td<{ $align?: 'left' | 'right' }>`
  padding: 16px 8px;
  text-align: ${props => props.$align || 'left'};
  color: #fff;
  font-size: 14px;
`

const PoolInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const PoolIcons = styled.div`
  display: flex;
  align-items: center;

  & > *:last-child {
    margin-left: -10px;
    border: 2px solid ${({ theme }) => theme.colors.themeColors[500]};
    border-radius: 50%;
  }
`

const PoolName = styled.div``

const PoolPair = styled.div`
  color: #fff;
  font-weight: 600;
  font-size: 14px;
`

const PoolFee = styled.div`
  color: ${({ theme }) => theme.colors.themeColors[100]};
  font-size: 12px;
`

const APRValue = styled.span<{ $positive?: boolean }>`
  color: ${props => (props.$positive ? '#00ff88' : '#fff')};
  font-weight: 600;
`

const ActionButtons = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`

const ActionButton = styled.button<{ $variant?: 'primary' | 'secondary' }>`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid
    ${props =>
      props.$variant === 'primary'
        ? '#6c38fe'
        : props.theme.colors.themeColors[300]};
  background: ${props =>
    props.$variant === 'primary' ? '#6c38fe' : 'transparent'};
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`

const EmptyState = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: ${({ theme }) => theme.colors.themeColors[100]};
`

// Helper functions
const formatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`
  }
  return `$${value.toFixed(2)}`
}

export const Pools: React.FC = () => {
  const navigate = useNavigate()
  const { pools, isLoading } = usePools()
  const [filter, setFilter] = useState<PoolFilter>('all')
  const [search, setSearch] = useState('')

  // Filter pools
  const filteredPools = pools.filter(pool => {
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase()
      const matchesSearch =
        pool.token0.symbol.toLowerCase().includes(searchLower) ||
        pool.token1.symbol.toLowerCase().includes(searchLower)
      if (!matchesSearch) return false
    }

    // Type filter
    switch (filter) {
      case 'stable':
        return pool.fee === '0.1%' // Stable pools have lower fee
      case 'volatile':
        return pool.fee === '0.5%'
      case 'my_pools':
        return false // TODO: Filter by user's pools
      default:
        return true
    }
  })

  // Calculate totals
  const totalLiquidity = pools.reduce((sum, p) => sum + p.liquidity, 0)
  const totalVolume24h = pools.reduce((sum, p) => sum + p.volume24h, 0)

  return (
    <PageLayout maxWidth="1000px">
      <Header>
        <HeaderLeft>
          <Title>Liquidity Pools</Title>
          <Subtitle>Provide liquidity, earn yield</Subtitle>
        </HeaderLeft>
        <HeaderStats>
          <StatBox>
            <StatLabel>TVL</StatLabel>
            <StatValue>{formatCurrency(totalLiquidity)}</StatValue>
          </StatBox>
          <StatBox>
            <StatLabel>Volume 24h</StatLabel>
            <StatValue>{formatCurrency(totalVolume24h)}</StatValue>
          </StatBox>
        </HeaderStats>
      </Header>

      <FiltersRow>
        <FilterTabs>
          <FilterTab
            $active={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All
          </FilterTab>
          <FilterTab
            $active={filter === 'stable'}
            onClick={() => setFilter('stable')}
          >
            Stable
          </FilterTab>
          <FilterTab
            $active={filter === 'volatile'}
            onClick={() => setFilter('volatile')}
          >
            Volatile
          </FilterTab>
          <FilterTab
            $active={filter === 'my_pools'}
            onClick={() => setFilter('my_pools')}
          >
            My Pools
          </FilterTab>
        </FilterTabs>

        <SearchRow>
          <SearchInput
            placeholder="Search pools..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <CreateButton onClick={() => navigate('/pool')}>
            + Create Pool
          </CreateButton>
        </SearchRow>
      </FiltersRow>

      <TableContainer>
        {isLoading ? (
          <EmptyState>Loading pools...</EmptyState>
        ) : filteredPools.length === 0 ? (
          <EmptyState>No pools found</EmptyState>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Pool</TableHeadCell>
                <TableHeadCell $align="right">Liquidity</TableHeadCell>
                <TableHeadCell $align="right">Volume 24h</TableHeadCell>
                <TableHeadCell $align="right">Fees 24h</TableHeadCell>
                <TableHeadCell $align="right">APR</TableHeadCell>
                <TableHeadCell $align="right">Actions</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {filteredPools.map(pool => (
                <TableRow key={pool.id}>
                  <TableCell>
                    <PoolInfo>
                      <PoolIcons>
                        <TokenIcon
                          address={pool.token0.address || ''}
                          symbol={pool.token0.symbol}
                          size={28}
                        />
                        <TokenIcon
                          address={pool.token1.address || ''}
                          symbol={pool.token1.symbol}
                          size={28}
                        />
                      </PoolIcons>
                      <PoolName>
                        <PoolPair>
                          {pool.token0.symbol}-{pool.token1.symbol}
                        </PoolPair>
                        <PoolFee>{pool.fee}</PoolFee>
                      </PoolName>
                    </PoolInfo>
                  </TableCell>
                  <TableCell $align="right">
                    {formatCurrency(pool.liquidity)}
                  </TableCell>
                  <TableCell $align="right">
                    {formatCurrency(pool.volume24h)}
                  </TableCell>
                  <TableCell $align="right">
                    {formatCurrency(pool.fees24h)}
                  </TableCell>
                  <TableCell $align="right">
                    <APRValue $positive={pool.apr > 0}>
                      {pool.apr.toFixed(2)}%
                    </APRValue>
                  </TableCell>
                  <TableCell $align="right">
                    <ActionButtons>
                      <ActionButton onClick={() => navigate('/')}>
                        Swap
                      </ActionButton>
                      <ActionButton
                        $variant="primary"
                        onClick={() => navigate('/pool')}
                      >
                        Deposit
                      </ActionButton>
                    </ActionButtons>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>
    </PageLayout>
  )
}

export default Pools
