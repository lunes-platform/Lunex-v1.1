import React, { useState } from 'react'
import styled from 'styled-components'
import { Heart, MessageCircle, Send } from 'lucide-react'
import {
  Badge,
  BareInput,
  Button,
  C,
  Card,
  Field,
  H3,
  Spinner,
  grotesk
} from 'components/ui/kit'
import { useSDK } from '../../../context/SDKContext'
import { useToast } from '../../../components/feedback/ToastProvider'
import socialApi, {
  buildCommentIdeaMessage,
  buildLikeIdeaMessage,
  buildUnlikeIdeaMessage,
  createSignedActionMetadata
} from '../../../services/socialService'
import { Idea, IdeaComment } from '../types'
import { relTime } from '../shared'

const Desc = styled.p<{ $clamp: boolean }>`
  font-size: 14px;
  line-height: 1.55;
  color: ${C.secondary};
  white-space: pre-wrap;
  ${p =>
    p.$clamp &&
    `display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;`}
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  font-size: 12px;
  color: ${C.muted};
`

const Act = styled.button<{ $on?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid ${C.borderStrong};
  background: ${p => (p.$on ? 'rgba(255,40,76,0.1)' : 'transparent')};
  color: ${p => (p.$on ? C.criticalText : C.secondary)};
  font-size: 12px;
  font-weight: 600;
  &:hover:not(:disabled) {
    color: #fff;
  }
`

const Comment = styled.div`
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.45;
  b {
    ${grotesk};
  }
`

const Initials = styled.span`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${C.borderStrong};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
`

const IdeaItem: React.FC<{ idea: Idea }> = ({ idea }) => {
  const { walletAddress, connectWallet, signMessage } = useSDK()
  const { toast } = useToast()
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(idea.likes)
  const [liking, setLiking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<IdeaComment[] | null>(null)
  const [loadingComments, setLoadingComments] = useState(false)
  const [input, setInput] = useState('')
  const [posting, setPosting] = useState(false)

  const fail = (title: string, err: unknown) =>
    toast('error', title, err instanceof Error ? err.message : undefined)

  const ensureWallet = async () => {
    if (walletAddress) return walletAddress
    try {
      await connectWallet()
    } catch (err: unknown) {
      fail('Wallet not connected', err)
    }
    return null
  }

  const onLike = async () => {
    const addr = await ensureWallet()
    if (!addr) return
    setLiking(true)
    try {
      const auth = createSignedActionMetadata()
      const msg = (liked ? buildUnlikeIdeaMessage : buildLikeIdeaMessage)({
        ideaId: idea.id,
        address: addr,
        nonce: auth.nonce,
        timestamp: auth.timestamp
      })
      const payload = {
        address: addr,
        nonce: auth.nonce,
        timestamp: auth.timestamp,
        signature: await signMessage(msg)
      }
      const res = liked
        ? await socialApi.unlikeIdea(idea.id, payload)
        : await socialApi.likeIdea(idea.id, payload)
      setLikes(res.likes ?? (liked ? Math.max(likes - 1, 0) : likes + 1))
      setLiked(!liked)
    } catch (err: unknown) {
      fail('Could not update like', err)
    } finally {
      setLiking(false)
    }
  }

  const toggleComments = async () => {
    const next = !open
    setOpen(next)
    if (next && comments === null) {
      setLoadingComments(true)
      try {
        setComments(await socialApi.getIdeaComments(idea.id, 50))
      } catch (err: unknown) {
        fail('Could not load comments', err)
      } finally {
        setLoadingComments(false)
      }
    }
  }

  const onPost = async () => {
    const content = input.trim()
    if (!content) return
    const addr = await ensureWallet()
    if (!addr) return
    setPosting(true)
    try {
      const auth = createSignedActionMetadata()
      const signature = await signMessage(
        buildCommentIdeaMessage({
          ideaId: idea.id,
          address: addr,
          content,
          nonce: auth.nonce,
          timestamp: auth.timestamp
        })
      )
      const c = await socialApi.commentOnIdea(idea.id, {
        address: addr,
        content,
        nonce: auth.nonce,
        timestamp: auth.timestamp,
        signature
      })
      setComments(prev => [c, ...(prev ?? [])])
      setInput('')
      toast('success', 'Comment posted')
    } catch (err: unknown) {
      fail('Could not post comment', err)
    } finally {
      setPosting(false)
    }
  }

  const bullish = idea.direction === 'Bullish'
  const long = idea.description.length > 220

  return (
    <Card $pad={16}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start'
        }}
      >
        <H3>{idea.title}</H3>
        <Badge $tone={bullish ? 'success' : 'critical'}>{idea.direction}</Badge>
      </div>
      <Desc $clamp={long && !expanded}>{idea.description}</Desc>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            alignSelf: 'flex-start',
            border: 'none',
            background: 'none',
            padding: 0,
            color: C.primaryText,
            fontSize: 13,
            fontWeight: 600
          }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      <Meta>
        <span>{idea.pair}</span>
        <span>{idea.date}</span>
        {idea.tags.map(t => (
          <Badge key={t} style={{ height: 20, fontSize: 11 }}>
            {t}
          </Badge>
        ))}
      </Meta>
      <div style={{ display: 'flex', gap: 8 }}>
        <Act
          type="button"
          $on={liked}
          aria-pressed={liked}
          disabled={liking}
          onClick={() => void onLike()}
        >
          {liking ? (
            <Spinner $size={12} />
          ) : (
            <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
          )}
          <span className="num">{likes}</span>
        </Act>
        <Act
          type="button"
          aria-expanded={open}
          onClick={() => void toggleComments()}
        >
          <MessageCircle size={14} />
          <span className="num">
            {comments ? comments.length : idea.comments}
          </span>
        </Act>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field style={{ flex: 1 }}>
              <BareInput
                placeholder="Add a comment"
                aria-label="Add a comment"
                value={input}
                maxLength={500}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void onPost()
                }}
              />
            </Field>
            <Button
              aria-label="Post comment"
              disabled={!input.trim() || posting}
              onClick={() => void onPost()}
              style={{ height: 44 }}
            >
              {posting ? <Spinner /> : <Send size={16} />}
            </Button>
          </div>
          {loadingComments ? (
            <span style={{ fontSize: 13, color: C.muted }}>
              Loading comments…
            </span>
          ) : comments && comments.length === 0 ? (
            <span style={{ fontSize: 13, color: C.muted }}>
              No comments yet.
            </span>
          ) : (
            (comments ?? []).map(c => (
              <Comment key={c.id}>
                <Initials>{c.initials}</Initials>
                <span>
                  <b>{c.author}</b>{' '}
                  <span style={{ color: C.muted, fontSize: 11 }}>
                    {relTime(c.createdAt)}
                  </span>
                  <br />
                  <span style={{ color: C.secondary }}>{c.content}</span>
                </span>
              </Comment>
            ))
          )}
        </div>
      )}
    </Card>
  )
}

export default IdeaItem
