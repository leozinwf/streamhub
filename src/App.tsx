import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { GripHorizontal, Maximize2, ArrowDown, ArrowUpDown, MonitorPlay, Bookmark } from 'lucide-react'
import { Search, Upload, Star, Tv, X, LoaderCircle, Menu, Home, Radio, Clock3, Trash2, Theater, List, LayoutGrid, Film, Clapperboard, ChevronDown, PanelRightOpen, Download, Settings, LogOut, LayoutDashboard } from 'lucide-react'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadMedia, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, MediaItem, Playlist } from './types'
import ModernPlayer from './components/Player'
import HomeFeed, { ChannelCard } from './components/HomeFeed'
import MediaLibrary, { MY_LIST, useGenres } from './components/MediaLibrary'
import { useWatchState } from './lib/watchState'
import { MEDIA_CATALOG_VERSION, isAdult } from './lib/mediaCatalog'
import AdultArea, { ADULT_TAB_ICONS, ADULT_TAB_LABELS, useAdultCatalog, type AdultTab } from './components/AdultArea'
import Mosaic, { CHANNEL_DRAG_TYPE, MOSAIC_LAYOUTS, MOSAIC_LIMIT, layoutCapacity, type MosaicLayout } from './components/Mosaic'
import { usePreference } from './lib/preferences'
import { CHANNEL_SORTS, CHANNEL_SORT_LABELS, QUALITY_FILTERS, QUALITY_FILTER_LABELS, bestQuality, channelQualities, type ChannelSort, type QualityFilter } from './lib/channelFilters'
import { createPlaylist, inferXtreamConnection, loadMediaCatalog } from './lib/xtream'
import { canonicalChannelKey, isAdultChannel, readStoredChannels, readStoredList, writeStoredChannels } from './lib/channelStore'
import { scrollToSection } from './lib/scroll'
import PlaylistSettings from './components/PlaylistSettings'
import ImportScreen from './components/ImportScreen'
import EpgGuide, { EpgConnectionContext } from './components/EpgGuide'
import { TvInfoBanner } from './components/TvOverlay'
import TvApp, { TvLiveBrowser, useTvLiveCatalog } from './components/tv/TvApp'
import { TvControls } from './components/tv/TvControls'
import { isTv } from './tv'
import MediaDetails from './components/MediaDetails'
import { groupLabel } from './lib/groupLabel'
import { recommendChannels } from './lib/recommend'
import { collapseChannelVariants, compareChannelNames, normalizeChannelKey } from './lib/channelVariants'
import { categorizeChannel, categorizeChannels, compareCategories, isForeignGroup } from './lib/categorize'

const EMPTY_CHANNELS: Channel[] = []
const TV_FIT_LABELS = { contain: 'original', cover: 'preencher', fill: 'esticar' } as const

const RECENT_STORAGE_KEY = 'streamhub-recent-channels'
const FAVORITES_STORAGE_KEY = 'streamhub-favorite-channels'
const MAX_RECENT_CHANNELS = 20
const THEATER_STORAGE_KEY = 'streamhub-theater-mode'
const LAST_LIVE_STORAGE_KEY = 'streamhub-last-live-channel'
const FAVORITE_GROUPS_STORAGE_KEY = 'streamhub-favorite-groups'
const MOSAIC_STORAGE_KEY = 'streamhub-mosaic-channels'


export default function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('Todos')
  const [selectedSubgroup, setSelectedSubgroup] = useState('Todos')
  const [contentMode, setContentMode] = usePreference<'home' | 'live' | 'movie' | 'series' | 'adult'>('streamhub-library', 'home', ['home', 'live', 'movie', 'series'])
  const [categoryStyle, setCategoryStyle] = usePreference('streamhub-category-style', 'smart', ['smart', 'provider'] as const)
  const [selectedMediaCategory, setSelectedMediaCategory] = useState('Todos')
  /** Movie or series whose details page is open. */
  const [selectedSeries, setSelectedSeries] = useState<MediaItem | null>(null)
  /** Episode order of the series being watched, for "next episode". */
  const [episodeQueue, setEpisodeQueue] = useState<Channel[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAccessPassword, setShowAccessPassword] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [recentChannels, setRecentChannels] = useState<Channel[]>([])
  const [favoriteChannels, setFavoriteChannels] = useState<Channel[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theaterMode, setTheaterMode] = useState(false)
  // The left navigation starts closed on the watch pages (like YouTube); ☰ opens it.
  const [navCollapsed, setNavCollapsed] = useState(true)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [channelPanelHidden, setChannelPanelHidden] = useState(false)
  const groupPickerRef = useRef<HTMLDivElement>(null)
  const autoRecommendRef = useRef(true)
  // All channels render at once (cards use content-visibility, so off-screen ones are cheap).
  const channelLimit = Number.MAX_SAFE_INTEGER
  const [channelView, setChannelView] = usePreference('streamhub-channel-view', 'grid', ['grid', 'list'] as const)
  const [miniPlayer, setMiniPlayer] = useState(false)
  /** Fire TV: video in full screen (true) or browsing the app (false). */
  const [tvWatching, setTvWatching] = useState(false)
  /** Fire TV: channel menu open over the video. */
  const [tvOverlay, setTvOverlay] = useState(false)
  const tvKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false)
  /** Fire TV: control bar over the video (opened with OK). */
  const [tvControls, setTvControls] = useState(false)
  /** Fire TV: channel order used for ↑ ↓ and the numbers (the list the channel was picked from). */
  const [tvZapList, setTvZapList] = useState<Channel[]>([])
  const [tvFit, setTvFit] = usePreference('streamhub-tv-fit', 'contain', ['contain', 'cover', 'fill'] as const)
  const tvAppBackRef = useRef<() => boolean>(() => false)
  const tvBackRef = useRef<() => boolean>(() => false)
  useEffect(() => {
    if (!isTv) return
    const w = window as unknown as Record<string, unknown>
    w.__streamhubWatchKey = (event: KeyboardEvent) => tvKeyRef.current(event)
    w.__streamhubWatchBack = () => tvBackRef.current()
  }, [])
  const [adultTab, setAdultTab] = useState<AdultTab>('live')
  const [adultSubgroup, setAdultSubgroup] = useState('Todos')
  const [channelSort, setChannelSort] = usePreference<ChannelSort>('streamhub-channel-sort', 'default', CHANNEL_SORTS)
  const [channelQuality, setChannelQuality] = usePreference<QualityFilter>('streamhub-channel-quality', 'all', QUALITY_FILTERS)
  const [channelOnlyFavorites, setChannelOnlyFavorites] = usePreference('streamhub-channel-only-favorites', '0', ['0', '1'] as const)
  /** The viewer closed the floating player; it stays docked until they scroll back up. */
  const [miniDismissed, setMiniDismissed] = useState(false)
  const [miniCorner, setMiniCorner] = usePreference<'br' | 'bl' | 'tr' | 'tl'>('streamhub-mini-corner', 'br', ['br', 'bl', 'tr', 'tl'])
  const [miniDrag, setMiniDrag] = useState<{ x: number; y: number } | null>(null)
  const floatingPlayer = miniPlayer && !miniDismissed
  /** Scroll position of the channel list before a click sent the page to the player. */
  const [listReturn, setListReturn] = useState<number | null>(null)
  /** Channel shown briefly after zapping with the keyboard. */
  const [zapToast, setZapToast] = useState<string | null>(null)
  const previousChannelRef = useRef<Channel | null>(null)
  const zapRef = useRef<(step: number | 'back') => void>(() => undefined)
  const [favoriteGroups, setFavoriteGroups] = useState<string[]>(() => readStoredList(FAVORITE_GROUPS_STORAGE_KEY))
  const [categoryQuery, setCategoryQuery] = useState('')
  const [mosaicMode, setMosaicMode] = usePreference('streamhub-mosaic-mode', '0', ['0', '1'] as const)
  const [mosaicChannels, setMosaicChannels] = useState<Channel[]>(() => readStoredChannels(MOSAIC_STORAGE_KEY, MOSAIC_LIMIT))
  const [mosaicNotice, setMosaicNotice] = useState<string | null>(null)
  /** Mosaic screen the next clicked channel goes to (null = none chosen). */
  const [mosaicTarget, setMosaicTarget] = useState<number | null>(null)
  const mosaicActive = mosaicMode === '1' && contentMode === 'live'
  const [mosaicLayout, setMosaicLayout] = usePreference<MosaicLayout>('streamhub-mosaic-layout', 'auto', MOSAIC_LAYOUTS)
  const mosaicCapacity = layoutCapacity(mosaicLayout)
  const playerSlotRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const slot = playerSlotRef.current
    if (!slot || (!selectedChannel && !mosaicActive) || theaterMode || isTv) { setMiniPlayer(false); return }
    const observer = new IntersectionObserver(([entry]) => {
      setMiniPlayer(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    }, { rootMargin: '-64px 0px 0px 0px' })
    observer.observe(slot)
    return () => observer.disconnect()
  }, [ready, playlist !== null, selectedChannel !== null, theaterMode, contentMode, mosaicActive])

  useEffect(() => { if (!miniPlayer) setMiniDismissed(false) }, [miniPlayer])
  useEffect(() => { setMiniDismissed(false) }, [selectedChannel?.id])
  const lastLiveRef = useRef<Channel | null>(null)
  useEffect(() => {
    if (!selectedChannel || (selectedChannel.kind && selectedChannel.kind !== 'live')) return
    if (lastLiveRef.current && lastLiveRef.current.id !== selectedChannel.id) previousChannelRef.current = lastLiveRef.current
    lastLiveRef.current = selectedChannel
  }, [selectedChannel?.id])
  useEffect(() => { if (!zapToast) return; const timer = window.setTimeout(() => setZapToast(null), 1800); return () => window.clearTimeout(timer) }, [zapToast])
  // Channel up/down: PageUp/PageDown or Shift+↑/↓; "U" returns to the last channel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const up = event.key === 'PageUp' || event.key === 'ChannelUp' || (event.shiftKey && event.key === 'ArrowUp')
      const down = event.key === 'PageDown' || event.key === 'ChannelDown' || (event.shiftKey && event.key === 'ArrowDown')
      if (up || down) { event.preventDefault(); zapRef.current(up ? -1 : 1) }
      else if (!event.shiftKey && event.key.toLowerCase() === 'u') { event.preventDefault(); zapRef.current('back') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // Forget the "back to the list" spot once the viewer scrolls down on their own.
  useEffect(() => {
    if (listReturn === null) return
    const onScroll = () => { if (window.scrollY > 200) setListReturn(null) }
    const timer = window.setTimeout(() => window.addEventListener('scroll', onScroll, { passive: true }), 900)
    return () => { window.clearTimeout(timer); window.removeEventListener('scroll', onScroll) }
  }, [listReturn])

  function closeMiniPlayer() {
    setMiniDismissed(true)
    document.querySelectorAll<HTMLVideoElement>('.player-screen video').forEach((video) => video.pause())
  }
  /** Drag the floating player by its bar; on release it snaps to the nearest corner. */
  function startMiniDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return
    const screen = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const offset = { x: event.clientX - screen.left, y: event.clientY - screen.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => setMiniDrag({ x: moveEvent.clientX - offset.x, y: moveEvent.clientY - offset.y })
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMiniDrag(null)
      const right = upEvent.clientX > window.innerWidth / 2
      const bottom = upEvent.clientY > window.innerHeight / 2
      setMiniCorner(`${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as 'br' | 'bl' | 'tr' | 'tl')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function changeChannelView(view: 'grid' | 'list') {
    setChannelView(view)
  }

  function changeCategoryStyle(style: 'smart' | 'provider') {
    setCategoryStyle(style)
    setSelectedGroup('Todos')
    setSelectedSubgroup('Todos')
  }

  useEffect(() => {
    setRecentChannels(readStoredChannels(RECENT_STORAGE_KEY, MAX_RECENT_CHANNELS).map(categorizeChannel))
    setFavoriteChannels(readStoredChannels(FAVORITES_STORAGE_KEY).map(categorizeChannel))
    try { setTheaterMode(localStorage.getItem(THEATER_STORAGE_KEY) === '1') } catch {}
    void loadPlaylist().then(async (stored) => {
      if (stored) {
        const categorized = { ...stored, channels: categorizeChannels(stored.channels) }
        setPlaylist(categorized)
        try {
          const last = JSON.parse(localStorage.getItem(LAST_LIVE_STORAGE_KEY) || 'null')
          if (last?.playlistId === categorized.id && typeof last.channelId === 'string') {
            const restored = collapseChannelVariants(categorized.channels).find((channel) =>
              channel.id === last.channelId || channel.variants?.some((variant) => variant.id === last.channelId))
            if (restored) {
              setSelectedChannel(restored)
              setContentMode('live')
            }
          }
        } catch { /* Ignore invalid or unavailable saved preferences. */ }
        setReady(true)
        // The catalog loads after the channels are on screen.
        const savedMedia = await loadMedia(categorized.id)
        if (savedMedia.length) setPlaylist((current) => current && current.id === categorized.id ? { ...current, media: savedMedia } : current)
        const connection = categorized.xtream || inferXtreamConnection(categorized.channels)
        // Refresh in the background when missing, saved in an older format, or older than a day.
        const stale = !categorized.mediaUpdatedAt || Date.now() - categorized.mediaUpdatedAt > 24 * 60 * 60 * 1000
        if (connection && (!savedMedia.length || categorized.mediaVersion !== MEDIA_CATALOG_VERSION || stale)) {
          void loadMediaCatalog(connection).then(async (media) => {
            if (!media.length) return
            const enriched = { ...categorized, xtream: connection, media, mediaVersion: MEDIA_CATALOG_VERSION, mediaUpdatedAt: Date.now() }
            setPlaylist((current) => current && current.id === categorized.id ? { ...current, xtream: connection, media, mediaVersion: MEDIA_CATALOG_VERSION, mediaUpdatedAt: enriched.mediaUpdatedAt } : current)
            await savePlaylist(enriched).catch(() => undefined)
          }).catch(() => undefined)
        }
      }
      setReady(true)
    })
  }, [])

  useEffect(() => {
    // Wait for playlist hydration before updating the saved selection.
    if (!ready) return
    try {
      const belongsToPlaylist = playlist?.channels.some((channel) =>
        channel.id === selectedChannel?.id || channel.variants?.some((variant) => variant.id === selectedChannel?.id))
      if (playlist && selectedChannel && belongsToPlaylist && (!selectedChannel.kind || selectedChannel.kind === 'live')) {
        localStorage.setItem(LAST_LIVE_STORAGE_KEY, JSON.stringify({ playlistId: playlist.id, channelId: selectedChannel.id }))
      } else {
        localStorage.removeItem(LAST_LIVE_STORAGE_KEY)
      }
    } catch { /* Storage may be unavailable. */ }
  }, [ready, playlist, selectedChannel])


  const tvCatalog = useTvLiveCatalog(isTv ? playlist?.channels || EMPTY_CHANNELS : EMPTY_CHANNELS, favoriteChannels, recentChannels)
  const xtreamConnection = useMemo(() => playlist?.xtream || inferXtreamConnection(playlist?.channels || []), [playlist?.xtream, playlist?.channels])
  const favoriteKeys = useMemo(() => new Set(favoriteChannels.map(canonicalChannelKey)), [favoriteChannels])
  const favoritePlaylistChannels = useMemo(() => playlist?.channels.filter((channel) => favoriteKeys.has(canonicalChannelKey(channel))) ?? [], [playlist, favoriteKeys])
  const regularPlaylistChannels = useMemo(() => playlist?.channels.filter((channel) => !isAdultChannel(channel)) ?? [], [playlist])
  const adultPlaylistChannels = useMemo(() => playlist?.channels.filter(isAdultChannel) ?? [], [playlist])
  const groupName = (channel: Channel) => categoryStyle === 'provider' ? channel.sourceGroup || channel.group : channel.group
  const groups = useMemo(() => Array.from(new Set(regularPlaylistChannels.map(groupName).filter(Boolean))).sort(categoryStyle === 'smart' ? compareCategories : (a, b) => Number(isForeignGroup(a)) - Number(isForeignGroup(b)) || a.localeCompare(b, 'pt-BR')), [regularPlaylistChannels, categoryStyle])
  const subgroups = useMemo(() => selectedGroup === 'Todos' || selectedGroup === 'Recomendados' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos'
    ? []
    : categoryStyle === 'provider' ? [] : Array.from(new Set(regularPlaylistChannels.filter((channel) => channel.group === selectedGroup).map((channel) => channel.subgroup).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  [regularPlaylistChannels, selectedGroup, categoryStyle])
  // Filtra categoria/subcategoria nos canais originais e só depois junta as
  // versões (HD/FHD), para que nenhum canal suma da categoria a que pertence.
  const filteredRegularChannels = useMemo(() => collapseChannelVariants(regularPlaylistChannels.filter((channel) => {
    if ((selectedGroup === 'Todos' || selectedGroup === 'Recomendados') && !query.trim() && channel.group === 'Internacionais') return false
    const groupMatch = selectedGroup === 'Todos' || selectedGroup === 'Recomendados' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos' || selectedGroup === '+18' || groupName(channel) === selectedGroup
    const subgroupMatch = selectedSubgroup === 'Todos' || channel.subgroup === selectedSubgroup
    return groupMatch && subgroupMatch
  })).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(a.group === 'Internacionais') - Number(b.group === 'Internacionais') || compareChannelNames(a, b)), [regularPlaylistChannels, query, selectedGroup, selectedSubgroup, categoryStyle])
  const recentCollapsed = useMemo(() => collapseChannelVariants(recentChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())), [recentChannels, query])
  const favoriteCollapsed = useMemo(() => collapseChannelVariants(favoritePlaylistChannels.filter((channel) => !isAdultChannel(channel))).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())).sort(compareChannelNames), [favoritePlaylistChannels, query])
  const adultCollapsed = useMemo(() => collapseChannelVariants(adultPlaylistChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())).sort(compareChannelNames), [adultPlaylistChannels, query])
  // Home feed (YouTube-style): every regular channel plus unfiltered favorites/recents.
  const homeChannels = useMemo(() => collapseChannelVariants(regularPlaylistChannels).sort(compareChannelNames), [regularPlaylistChannels])
  const homeFavorites = useMemo(() => collapseChannelVariants(favoritePlaylistChannels.filter((channel) => !isAdultChannel(channel))).sort(compareChannelNames), [favoritePlaylistChannels])
  useEffect(() => {
    if (!groupPickerOpen) return
    const close = (event: PointerEvent) => { if (!groupPickerRef.current?.contains(event.target as Node)) setGroupPickerOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setGroupPickerOpen(false) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', onKey) }
  }, [groupPickerOpen])
  useEffect(() => {
    if (contentMode === 'live' && selectedChannel && autoRecommendRef.current && selectedGroup === 'Todos') setSelectedGroup('Recomendados')
  }, [selectedChannel?.id, contentMode])
  const homeRecents = useMemo(() => collapseChannelVariants(recentChannels.filter((channel) => !isAdultChannel(channel))), [recentChannels])
  // "A seguir": channels similar to the one being watched (same brand, then same kind).
  const recommendations = useMemo(() => selectedChannel && (!selectedChannel.kind || selectedChannel.kind === 'live') ? recommendChannels(selectedChannel, homeChannels) : null, [selectedChannel?.id, homeChannels])
  const recommendedChannels = useMemo(() => {
    if (!recommendations) return null
    const list = [...recommendations.sameBrand, ...recommendations.related]
    const key = query.trim().toLowerCase()
    return key ? list.filter((channel) => channel.name.toLowerCase().includes(key)) : list
  }, [recommendations, query])
  const isFavoriteChannel = (channel: Channel) => favoriteKeys.has(canonicalChannelKey(channel))
  const showingRecommendations = selectedGroup === 'Recomendados' && recommendedChannels !== null
  const baseChannels = showingRecommendations ? recommendedChannels : selectedGroup === 'Recentes' ? recentCollapsed : selectedGroup === 'Favoritos' ? favoriteCollapsed : selectedGroup === '+18' ? adultCollapsed : filteredRegularChannels
  // Sorting and filters for the channel list (not applied to recommendations, which are grouped).
  const channels = useMemo(() => {
    if (showingRecommendations) return baseChannels
    const recentRank = new Map(recentChannels.map((channel, index) => [canonicalChannelKey(channel), index]))
    let list = baseChannels
    if (channelOnlyFavorites === '1') list = list.filter(isFavoriteChannel)
    if (channelQuality !== 'all') list = list.filter((channel) => channelQualities(channel).includes(channelQuality))
    if (channelSort === 'default') return list
    const sorted = list.slice()
    const byName = (a: Channel, b: Channel) => compareChannelNames(a, b)
    if (channelSort === 'az') sorted.sort(byName)
    else if (channelSort === 'za') sorted.sort((a, b) => byName(b, a))
    else if (channelSort === 'category') sorted.sort((a, b) => compareCategories(a.group, b.group) || (a.subgroup || '').localeCompare(b.subgroup || '', 'pt-BR') || byName(a, b))
    else if (channelSort === 'quality') sorted.sort((a, b) => bestQuality(b) - bestQuality(a) || (b.variants?.length || 1) - (a.variants?.length || 1) || byName(a, b))
    else if (channelSort === 'favorites') sorted.sort((a, b) => Number(isFavoriteChannel(b)) - Number(isFavoriteChannel(a)) || byName(a, b))
    else if (channelSort === 'recent') sorted.sort((a, b) => (recentRank.get(canonicalChannelKey(a)) ?? 1e9) - (recentRank.get(canonicalChannelKey(b)) ?? 1e9) || byName(a, b))
    return sorted
  }, [baseChannels, showingRecommendations, channelSort, channelQuality, channelOnlyFavorites, recentChannels, favoriteKeys])
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const channel of regularPlaylistChannels) { const name = groupName(channel); counts.set(name, (counts.get(name) || 0) + 1) }
    return counts
  }, [regularPlaylistChannels, categoryStyle])
  const groupKey = (group: string) => `${categoryStyle}::${group}`
  const categoryFilter = (group: string) => normalizeChannelKey(group).includes(normalizeChannelKey(categoryQuery))
  const favoriteGroupList = groups.filter((group) => favoriteGroups.includes(groupKey(group)))
  const visibleGroups = groups.filter(categoryFilter)
  zapRef.current = (step) => {
    if (contentMode !== 'live' && contentMode !== 'adult' && contentMode !== 'home') return
    if (mosaicActive) return
    let target: Channel | undefined
    if (step === 'back') target = previousChannelRef.current || undefined
    else {
      const list = isTv && tvZapList.length ? tvZapList : contentMode === 'adult' ? adultChannelList : tvChannelList
      if (!list.length) return
      const index = selectedChannel ? list.findIndex((channel) => channel.id === selectedChannel.id || channel.url === selectedChannel.url || channel.variants?.some((variant) => variant.id === selectedChannel.id)) : -1
      target = list[(index + step + list.length) % list.length]
    }
    if (!target) { if (step === 'back') setZapToast('Nenhum canal anterior'); return }
    setSelectedChannel(target)
    addRecent(target)
    if (!isTv) setZapToast(`${step === 'back' ? '↺' : step < 0 ? '▲' : '▼'} ${target.name}`)
  }
  const tvFullscreen = isTv && tvWatching && Boolean(selectedChannel) && !mosaicActive
  useEffect(() => {
    const root = document.documentElement.classList
    root.toggle('tv-watching', tvFullscreen)
    root.toggle('tv-menu-open', tvFullscreen && (tvOverlay || tvControls))
    root.toggle('tv-fit-cover', tvFit === 'cover')
    root.toggle('tv-fit-fill', tvFit === 'fill')
    if (!tvFullscreen && (tvOverlay || tvControls)) { setTvOverlay(false); setTvControls(false) }
  }, [tvFullscreen, tvOverlay, tvControls, tvFit])
  // Channel order for zapping and the Fire TV menu: the list on screen, but never the
  // "Recomendados" list (which doesn't contain the channel being watched).
  const tvChannelList = useMemo(() => !showingRecommendations && channels.length ? channels : collapseChannelVariants(regularPlaylistChannels).sort(compareChannelNames), [showingRecommendations, channels, regularPlaylistChannels])
  // Fire TV full-screen keys (called by tv.ts while watching with the menu closed).
  tvKeyRef.current = (event) => {
    const video = document.querySelector<HTMLVideoElement>('.player-screen video')
    const live = !selectedChannel?.kind || selectedChannel.kind === 'live'
    const key = event.key
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ChannelUp' || key === 'ChannelDown' || key === 'PageUp' || key === 'PageDown') {
      if (!live) { setTvControls(true); return true }
      zapRef.current(key === 'ArrowUp' || key === 'ChannelUp' || key === 'PageUp' ? -1 : 1)
      return true
    }
    if (key === 'Enter' || key === ' ' || key === 'ContextMenu') { setTvControls(true); return true }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (live) { if (key === 'ArrowLeft') setTvOverlay(true); else setTvControls(true); return true }
      if (video) video.currentTime = Math.max(0, video.currentTime + (key === 'ArrowLeft' ? -10 : 10))
      setTvControls(true)
      return true
    }
    return false
  }
  tvBackRef.current = () => {
    if (!tvWatching) return tvAppBackRef.current()
    if (tvOverlay) { setTvOverlay(false); return true }
    if (tvControls) { setTvControls(false); return true }
    setTvWatching(false)
    return true
  }
  const isActiveChannel = (channel: Channel) => mosaicActive
    ? mosaicChannels.some((item) => item.id === channel.id || item.url === channel.url)
    : selectedChannel?.url === channel.url
  // Adult titles live only in the separate +18 area.
  const mediaItems = useMemo(() => (playlist?.media || []).filter((item) => item.kind === contentMode && !isAdult(item)), [playlist?.media, contentMode])
  const adultMedia = useMemo(() => (playlist?.media || []).filter(isAdult), [playlist?.media])
  const adultChannelList = useMemo(() => collapseChannelVariants(adultPlaylistChannels).sort(compareChannelNames), [adultPlaylistChannels])
  const hasAdultArea = adultChannelList.length > 0 || adultMedia.length > 0
  const adultCatalog = useAdultCatalog(adultChannelList, adultMedia, adultTab)
  function changeAdultTab(tab: AdultTab) { setAdultTab(tab); setAdultSubgroup('Todos'); setSidebarOpen(false); scrollToSection('.adult-section') }
  function changeAdultSubgroup(name: string) { setAdultSubgroup(name); setSidebarOpen(false); scrollToSection('.adult-section') }
  const { counts: mediaGenres } = useGenres(mediaItems)
  const watchState = useWatchState()
  const myListCount = useMemo(() => watchState.myList.filter((item) => item.kind === contentMode).length, [watchState.myList, contentMode])

  function addRecent(channel: Channel) {
    setRecentChannels((current) => {
      const next = [channel, ...current.filter((item) => canonicalChannelKey(item) !== canonicalChannelKey(channel))].slice(0, MAX_RECENT_CHANNELS)
      writeStoredChannels(RECENT_STORAGE_KEY, next, MAX_RECENT_CHANNELS); return next
    })
  }
  function removeRecent(channel: Channel) {
    setRecentChannels((current) => { const next = current.filter((item) => canonicalChannelKey(item) !== canonicalChannelKey(channel)); writeStoredChannels(RECENT_STORAGE_KEY, next, MAX_RECENT_CHANNELS); return next })
  }
  function toggleFavoriteGroup(group: string) {
    const key = groupKey(group)
    setFavoriteGroups((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
      try { localStorage.setItem(FAVORITE_GROUPS_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  function updateMosaic(next: Channel[]) { setMosaicChannels(next); writeStoredChannels(MOSAIC_STORAGE_KEY, next, MOSAIC_LIMIT) }
  function flashMosaicNotice(message: string) { setMosaicNotice(message); window.setTimeout(() => setMosaicNotice(null), 3200) }
  function changeMosaicLayout(next: MosaicLayout) {
    setMosaicLayout(next)
    const capacity = layoutCapacity(next)
    if (mosaicChannels.length > capacity) {
      const removed = mosaicChannels.slice(capacity)
      updateMosaic(mosaicChannels.slice(0, capacity))
      flashMosaicNotice(`${removed.map((item) => item.name).join(', ')} ${removed.length > 1 ? 'saíram' : 'saiu'} do mosaico para caber no layout.`)
    }
  }
  function removeFromMosaic(channel: Channel) { updateMosaic(mosaicChannels.filter((item) => item.id !== channel.id)); setMosaicTarget(null) }
  const sameChannel = (a: Channel, b: Channel) => a.id === b.id || a.url === b.url
  /** Puts a channel on screen `index` (replacing what is there, or filling an empty screen). */
  function placeInMosaic(channel: Channel, index: number) {
    const current = mosaicChannels.findIndex((item) => sameChannel(item, channel))
    const next = mosaicChannels.slice()
    if (current >= 0) {
      // Already on another screen: swap the two screens.
      if (current === index) return
      if (index < next.length) [next[current], next[index]] = [next[index], next[current]]
      else { next.splice(current, 1); next.push(channel) }
    } else if (index < next.length) next[index] = channel
    else if (next.length < mosaicCapacity) next.push(channel)
    else return
    updateMosaic(next)
    addRecent(channel)
  }
  function moveInMosaic(from: number, to: number) {
    if (from === to || from >= mosaicChannels.length) return
    const next = mosaicChannels.slice()
    if (to >= next.length) { const [item] = next.splice(from, 1); next.push(item) }
    else [next[from], next[to]] = [next[to], next[from]]
    updateMosaic(next)
    setMosaicTarget(null)
  }
  function toggleMosaic() {
    if (mosaicMode === '1') {
      setMosaicMode('0')
      if (mosaicChannels[0]) setSelectedChannel(mosaicChannels[0])
      return
    }
    if (!mosaicChannels.length && selectedChannel && (!selectedChannel.kind || selectedChannel.kind === 'live')) updateMosaic([selectedChannel])
    setMosaicMode('1')
  }
  function selectChannel(channel: Channel) {
    if (mosaicActive && (!channel.kind || channel.kind === 'live')) {
      setSidebarOpen(false)
      const existing = mosaicChannels.findIndex((item) => sameChannel(item, channel))
      // A chosen screen gets the channel; otherwise it fills the next empty screen.
      if (mosaicTarget !== null && mosaicTarget < mosaicCapacity) {
        placeInMosaic(channel, mosaicTarget)
        const nextEmpty = existing < 0 && mosaicTarget >= mosaicChannels.length && mosaicChannels.length + 1 < mosaicCapacity ? mosaicChannels.length + 1 : null
        setMosaicTarget(nextEmpty)
        return
      }
      if (existing >= 0) { flashMosaicNotice(`${channel.name} já está no mosaico. Clique numa tela para escolher onde colocar outro canal.`); return }
      if (mosaicChannels.length >= mosaicCapacity) { flashMosaicNotice('Mosaico cheio. Clique na tela que quer trocar (ou arraste o canal até ela) e depois escolha o canal.'); return }
      placeInMosaic(channel, mosaicChannels.length)
      return
    }
    setSelectedChannel(channel)
    addRecent(channel)
    setSidebarOpen(false)
    // Go up to the player. A side panel keeps its own scroll; when the list sits
    // below the player, remember where it was so "Voltar à lista" can return there.
    // Fire TV: picking something to watch goes straight to full screen.
    if (isTv) { setTvWatching(true); setTvOverlay(false); return }
    if (window.scrollY > 240) setListReturn(window.scrollY)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function toggleFavorite(channel: Channel) { const key = canonicalChannelKey(channel); setFavoriteChannels((current) => { const exists = current.some((item) => canonicalChannelKey(item) === key); const next = exists ? current.filter((item) => canonicalChannelKey(item) !== key) : [channel, ...current]; writeStoredChannels(FAVORITES_STORAGE_KEY, next); return next }) }
  function clearRecents() { setRecentChannels([]); try { localStorage.removeItem(RECENT_STORAGE_KEY) } catch {}; if (selectedGroup === 'Recentes') setSelectedGroup('Todos') }
  function selectGroup(group: string) { autoRecommendRef.current = group === 'Recomendados'; setSelectedGroup(group); setSelectedSubgroup('Todos'); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function selectContentMode(nextMode: 'home' | 'live' | 'movie' | 'series' | 'adult') { setContentMode(nextMode); setSelectedMediaCategory('Todos'); setSelectedSeries(null); setSidebarOpen(false) }
  async function openLibrary(nextMode: 'live' | 'movie' | 'series') {
    const labels = { live: 'TV ao vivo', movie: 'filmes', series: 'séries' }
    setLibraryLoading(`Carregando ${labels[nextMode]}...`)
    await new Promise((resolve) => setTimeout(resolve, 450))
    selectContentMode(nextMode)
    setLibraryLoading(null)
  }
  /** Cards open the details page; playback starts from there. */
  function openMedia(item: MediaItem) { setSelectedSeries(item); scrollToSection('.media-library') }
  const playMovie = openMedia
  const openSeries = openMedia
  function playFromDetails(channel: Channel, queue?: Channel[]) {
    setEpisodeQueue(queue || [])
    selectChannel(channel)
  }
  /** End of an episode: start the next one of the same series. */
  function playNextEpisode() {
    if (!selectedChannel || selectedChannel.kind !== 'series') return
    const index = episodeQueue.findIndex((episode) => episode.id === selectedChannel.id)
    const next = index >= 0 ? episodeQueue[index + 1] : undefined
    if (next) { setSelectedChannel(next); addRecent(next) }
  }
  function toggleNav() {
    if (window.matchMedia('(max-width: 800px)').matches) { setSidebarOpen((value) => !value); return }
    setNavCollapsed((value) => !value)
  }
  function toggleTheater() { setTheaterMode((current) => { const next = !current; try { localStorage.setItem(THEATER_STORAGE_KEY, next ? '1' : '0') } catch {}; return next }) }
  function exportM3u() {
    if (!playlist?.channels.length) return
    const connection = playlist.xtream || inferXtreamConnection(playlist.channels)
    if (connection) {
      const link = document.createElement('a')
      link.href = `/api/export?server=${encodeURIComponent(connection.server)}&username=${encodeURIComponent(connection.username)}&password=${encodeURIComponent(connection.password)}`
      link.download = 'streamhub-completo.m3u'
      link.click()
      return
    }
    const escapeAttribute = (value: string) => value.replace(/"/g, "'")
    const lines = ['#EXTM3U', ...playlist.channels.flatMap((channel) => {
      const attributes = [
        channel.tvgId ? `tvg-id="${escapeAttribute(channel.tvgId)}"` : '',
        channel.tvgName ? `tvg-name="${escapeAttribute(channel.tvgName)}"` : '',
        channel.logo ? `tvg-logo="${escapeAttribute(channel.logo)}"` : '',
        `group-title="${escapeAttribute(channel.sourceGroup || channel.group)}"`,
      ].filter(Boolean).join(' ')
      return [`#EXTINF:-1 ${attributes},${channel.name}`, channel.url]
    })]
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${playlist.name.replace(/[^a-z0-9áàâãéêíóôõúç _-]/gi, '').trim() || 'streamhub'}.m3u`
    link.click()
    URL.revokeObjectURL(url)
  }
  async function importFile(file: File) { await importContent(file.name.replace(/\.[^.]+$/, '') || 'Minha playlist', await file.text()) }
  async function importContent(name: string, content: string) { const channels = parseM3U(content); if (!channels.length) return window.alert('Nenhum canal válido foi encontrado nessa playlist.'); const next = createPlaylist(name, channels); await savePlaylist(next); setPlaylist(next); setSelectedGroup('Todos') }
  function reset() { void clearPlaylist(); clearRecents(); setFavoriteChannels([]); try { localStorage.removeItem(FAVORITES_STORAGE_KEY) } catch {}; setPlaylist(null); setSelectedChannel(null); setSelectedGroup('Todos'); setQuery('') }
  function logout() { if (window.confirm('Sair e remover a lista salva deste aparelho?')) reset() }

  if (!ready) return <div className="loading-screen">Carregando StreamHub...</div>
  if (!playlist) return <ImportScreen onImportFile={(file) => void importFile(file)} onImportText={importContent} onConnected={async (next) => { await savePlaylist(next); setPlaylist(next); setSelectedGroup('Todos'); setContentMode('home') }} />

  // Fire TV: its own interface (main menu, provider categories, full-screen video).
  if (isTv) {
    const live = !selectedChannel?.kind || selectedChannel.kind === 'live'
    const tvNumber = selectedChannel && live ? tvZapList.findIndex((channel) => channel.id === selectedChannel.id || channel.url === selectedChannel.url) + 1 || undefined : undefined
    const playLive = (channel: Channel, list: Channel[]) => { setTvZapList(list); setTvControls(false); setTvOverlay(false); setSelectedChannel(channel); addRecent(channel); setTvWatching(true) }
    return <EpgConnectionContext.Provider value={xtreamConnection}>
      <TvApp playlistName={playlist.name} channels={playlist.channels} media={playlist.media || []} favorites={favoriteChannels} recents={recentChannels} connection={xtreamConnection} current={selectedChannel} watching={tvFullscreen}
        onPlayChannel={playLive}
        onPlayMedia={(channel, queue) => { setEpisodeQueue(queue || []); setTvControls(false); setSelectedChannel(channel); setTvWatching(true) }}
        onSettings={() => setSettingsOpen(true)} backRef={tvAppBackRef} />
      {tvFullscreen && selectedChannel && <div className="player-screen tv-player"><ModernPlayer channel={selectedChannel} onEnded={playNextEpisode} onToggleFullscreen={() => setTvWatching(false)} /></div>}
      {tvFullscreen && selectedChannel && !tvControls && !tvOverlay && <TvInfoBanner key={selectedChannel.id} channel={selectedChannel} number={tvNumber} hint={live ? '↑ ↓ trocar canal · OK opções · ← lista de canais' : 'OK opções · ← → 10 s'} />}
      {tvFullscreen && selectedChannel && tvControls && !tvOverlay && <TvControls channel={selectedChannel} number={tvNumber} fitLabel={TV_FIT_LABELS[tvFit]}
        onPrevious={() => zapRef.current(-1)} onNext={() => zapRef.current(1)} onList={() => { setTvControls(false); setTvOverlay(true) }}
        onFit={() => setTvFit(tvFit === 'contain' ? 'cover' : tvFit === 'cover' ? 'fill' : 'contain')} onExit={() => setTvWatching(false)} />}
      {tvFullscreen && tvOverlay && <div className="tv-overlay" role="dialog" aria-modal="true" aria-label="Lista de canais">
        <TvLiveBrowser overlay categories={tvCatalog.categories} channelsOf={tvCatalog.channelsOf} current={selectedChannel} initialCategory={selectedChannel ? tvCatalog.categoryOf(selectedChannel) : undefined} onPlay={playLive} />
      </div>}
      {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={tvCatalog.categories.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
    </EpgConnectionContext.Provider>
  }

  if (contentMode === 'home') return <>
    <HomeFeed
      channels={homeChannels}
      favorites={homeFavorites}
      recents={homeRecents}
      media={playlist.media || []}
      groups={groups}
      groupCounts={groupCounts}
      groupOf={groupName}
      isFavorite={isFavoriteChannel}
      onPlay={(channel) => { autoRecommendRef.current = true; selectContentMode('live'); setSelectedGroup('Todos'); setSelectedSubgroup('Todos'); setMosaicMode('0'); selectChannel(channel); window.scrollTo({ top: 0 }) }}
      onPlayMovie={(item) => { selectContentMode('movie'); setSelectedSeries(item); window.scrollTo({ top: 0 }) }}
      onOpenSeries={(item) => { selectContentMode('series'); setSelectedSeries(item); window.scrollTo({ top: 0 }) }}
      onOpenLibrary={(nextMode) => void openLibrary(nextMode)}
      onToggleFavorite={toggleFavorite}
      onClearRecents={clearRecents}
      onRemoveRecent={removeRecent}
      onImport={() => fileRef.current?.click()}
      onExport={exportM3u}
      onSettings={() => setSettingsOpen(true)}
      onLogout={logout}
    />
    <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
    {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={groups.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
    {libraryLoading && <div className="library-loading" role="status" aria-live="polite"><div><LoaderCircle className="spin" size={34} /><strong>{libraryLoading}</strong><span>Preparando sua biblioteca e seus dados de acesso</span></div></div>}
  </>

  const favorite = selectedChannel ? favoriteKeys.has(canonicalChannelKey(selectedChannel)) : false
  const recommendationHeading = (index: number) => {
    if (!showingRecommendations || !recommendations || query.trim()) return null
    if (index === 0 && recommendations.sameBrand.length) return <div className="yt-reco-head">Mais de {recommendations.brand}</div>
    if (index === recommendations.sameBrand.length && recommendations.related.length) return <div className="yt-reco-head">Outros canais de {groupLabel(recommendations.category).toLowerCase()}</div>
    return null
  }
  const renderGroup = (group: string, section: 'fav' | 'all') => {
    const isFav = favoriteGroups.includes(groupKey(group))
    return <div key={`${section}-${group}`} className="nav-row">
      <button className={selectedGroup === group ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup(group)}>{isFav ? <Star size={16} fill="currentColor" className="nav-fav-icon" /> : <Radio size={17} />}<span>{groupLabel(group)}</span><small>{groupCounts.get(group) || 0}</small></button>
      <button className={isFav ? 'nav-fav active' : 'nav-fav'} aria-pressed={isFav} aria-label={isFav ? `Remover ${group} das categorias favoritas` : `Favoritar a categoria ${group}`} title={isFav ? 'Remover dos favoritos' : 'Favoritar categoria'} onClick={() => toggleFavoriteGroup(group)}><Star size={14} fill={isFav ? 'currentColor' : 'none'} /></button>
    </div>
  }
  return <EpgConnectionContext.Provider value={xtreamConnection}><div className={`app-shell yt-skin ${theaterMode ? 'theater-mode' : ''} ${navCollapsed ? 'nav-collapsed' : ''}`}>
    <header className="topbar yt-topbar">
      <div className="yt-topbar-start"><button className="yt-icon-btn" onClick={toggleNav} aria-label="Menu" title="Menu"><Menu size={22} /></button><button className="yt-logo" onClick={() => selectContentMode('home')} title="Início do StreamHub"><span className="yt-logo-mark"><Tv size={16} /></span><span>StreamHub</span></button></div>
      <form className="yt-search" role="search" onSubmit={(event) => { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}><div className="yt-search-box"><Search size={17} className="yt-search-icon" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={contentMode === 'movie' ? 'Pesquisar filmes' : contentMode === 'series' ? 'Pesquisar séries' : contentMode === 'adult' ? 'Pesquisar na área +18' : 'Pesquisar canais'} aria-label="Pesquisar" />{query && <button className="yt-search-clear" type="button" aria-label="Limpar pesquisa" onClick={() => setQuery('')}><X size={18} /></button>}</div><button type="submit" className="yt-search-btn" aria-label="Pesquisar" title="Pesquisar"><Search size={20} /></button></form>
      <div className="yt-topbar-end">{contentMode === 'live' && <button className={mosaicActive ? 'yt-icon-btn yt-hide-sm active' : 'yt-icon-btn yt-hide-sm'} onClick={toggleMosaic} title={mosaicActive ? 'Sair do mosaico' : 'Mosaico: assistir até 4 canais'} aria-pressed={mosaicActive}><LayoutDashboard size={18} /></button>}<button className={theaterMode ? 'yt-icon-btn yt-hide-sm active' : 'yt-icon-btn yt-hide-sm'} onClick={toggleTheater} title={theaterMode ? 'Sair do modo teatro' : 'Modo teatro'} aria-pressed={theaterMode}><Theater size={19} /></button><button className="yt-icon-btn yt-hide-sm" onClick={exportM3u} title="Exportar canais em M3U"><Download size={19} /></button><button className="yt-icon-btn yt-hide-sm" onClick={() => fileRef.current?.click()} title="Importar outra playlist"><Upload size={19} /></button><button className="yt-icon-btn" onClick={() => setSettingsOpen(true)} title="Configurações e acesso"><Settings size={19} /></button><button className="yt-icon-btn" onClick={logout} title="Sair e remover a lista deste aparelho"><LogOut size={19} /></button></div>
      <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /></header>
    <div className="layout"><main className="content"><section className={!selectedChannel && !mosaicActive ? 'watch-area is-empty' : 'watch-area'}><div className="player-card"><div ref={playerSlotRef} className="player-slot"><div className={`player-screen ${floatingPlayer ? `mini-player mini-${miniCorner}${miniDrag ? ' mini-dragging' : ''}` : ''}`} style={floatingPlayer && miniDrag ? { left: miniDrag.x, top: miniDrag.y, right: 'auto', bottom: 'auto' } : undefined}>{floatingPlayer && <div className="mini-bar" onPointerDown={startMiniDrag} title="Arraste para mudar de canto"><GripHorizontal size={16} /><span>Arraste para mover</span><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Voltar ao player"><Maximize2 size={14} /> Expandir</button><button onClick={closeMiniPlayer} title="Fechar (pausa o canal)" aria-label="Fechar mini player"><X size={16} /></button></div>}{mosaicActive ? <Mosaic channels={mosaicChannels} onRemove={removeFromMosaic} notice={mosaicNotice} layout={mosaicLayout} onLayoutChange={(next) => { setMosaicTarget(null); changeMosaicLayout(next) }} target={mosaicTarget} onTarget={setMosaicTarget} onMove={moveInMosaic} onDropChannel={(channel, index) => { placeInMosaic(channel, index); setMosaicTarget(null) }} /> : <ModernPlayer channel={selectedChannel} theaterMode={theaterMode} onToggleTheater={toggleTheater} onEnded={playNextEpisode} onToggleFullscreen={isTv ? () => setTvWatching((value) => !value) : undefined} />}</div></div>{selectedChannel && !mosaicActive && <div className="video-meta"><div className="video-meta-logo">{selectedChannel.logo ? <img src={selectedChannel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={20} />}</div><div className="video-meta-info"><h1>{selectedChannel.name}</h1><p>{selectedChannel.kind === 'movie' ? `Filme · ${selectedChannel.subgroup || ''}` : selectedChannel.kind === 'series' ? selectedChannel.subgroup : `${groupLabel(selectedChannel.group)} · transmissão ao vivo`}</p></div>{(!selectedChannel.kind || selectedChannel.kind === 'live') && <button className={favorite ? 'yt-subscribe active' : 'yt-subscribe'} onClick={() => toggleFavorite(selectedChannel)} title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-pressed={favorite}><Star size={17} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favoritado' : 'Favoritar'}</button>}{contentMode === 'live' && channelPanelHidden && <button className="yt-subscribe active yt-show-panel" onClick={() => setChannelPanelHidden(false)} title="Mostrar lista de canais"><PanelRightOpen size={17} />Mostrar canais</button>}</div>}</div></section>
      {contentMode === 'live' && selectedChannel && !mosaicActive && <EpgGuide channel={selectedChannel} connection={xtreamConnection} />}
      {contentMode === 'adult' && !selectedSeries ? <section className="channels-section media-library adult-section">
        <div className="section-heading"><div><span className="eyebrow">CONTEÚDO ADULTO</span><h2>Área +18</h2></div><span className="count">{(adultChannelList.length + adultMedia.length).toLocaleString('pt-BR')} itens</span></div>
        <AdultArea channels={adultChannelList} media={adultMedia} query={query} tab={adultTab} subgroup={adultSubgroup} onTabChange={changeAdultTab} onSubgroupChange={changeAdultSubgroup} isFavorite={isFavoriteChannel} isActive={isActiveChannel} onPlayChannel={selectChannel} onToggleFavorite={toggleFavorite} onOpenMedia={(item) => item.kind === 'movie' ? playMovie(item) : void openSeries(item)} />
      </section> : contentMode === 'live' ? channelPanelHidden ? null : <section className="channels-section">
        <div className="section-heading yt-panel-head">
          <div className="yt-panel-picker" ref={groupPickerRef}>
            <button className="yt-panel-title" onClick={() => setGroupPickerOpen((value) => !value)} aria-haspopup="menu" aria-expanded={groupPickerOpen} title="Escolher o que listar">{showingRecommendations ? <>Recomendados <small className="yt-panel-sub">parecidos com {selectedChannel?.name}</small></> : selectedGroup === '+18' ? 'Área +18' : selectedGroup === 'Todos' || selectedGroup === 'Recomendados' ? 'Todos os canais' : groupLabel(selectedGroup)}<ChevronDown size={18} /></button>
            {groupPickerOpen && <div className="yt-panel-menu" role="menu">
              {recommendations && <button role="menuitemradio" aria-checked={selectedGroup === 'Recomendados'} className={selectedGroup === 'Recomendados' ? 'active' : ''} onClick={() => { selectGroup('Recomendados'); setGroupPickerOpen(false) }}><span>Recomendados · parecidos com {selectedChannel?.name}</span></button>}
              {[['Todos', 'Todos os canais', null], ['Recentes', 'Vistos recentemente', recentChannels.length], ['Favoritos', 'Favoritos', favoriteChannels.length]].map(([id, label, count]) => <button key={String(id)} role="menuitemradio" aria-checked={selectedGroup === id} className={selectedGroup === id ? 'active' : ''} onClick={() => { selectGroup(String(id)); setGroupPickerOpen(false) }}><span>{label}</span>{count !== null && <small>{Number(count)}</small>}</button>)}
              <div className="yt-panel-menu-title">Categorias</div>
              {groups.filter((group) => group !== 'Internacionais' && !isForeignGroup(group)).map((group) => <button key={group} role="menuitemradio" aria-checked={selectedGroup === group} className={selectedGroup === group ? 'active' : ''} onClick={() => { selectGroup(group); setGroupPickerOpen(false) }}><span>{groupLabel(group)}</span><small>{(groupCounts.get(group) || 0).toLocaleString('pt-BR')}</small></button>)}
              {groups.some((group) => group === 'Internacionais' || isForeignGroup(group)) && <div className="yt-panel-menu-title">Internacionais</div>}
              {groups.filter((group) => group === 'Internacionais' || isForeignGroup(group)).map((group) => <button key={group} role="menuitemradio" aria-checked={selectedGroup === group} className={selectedGroup === group ? 'active' : ''} onClick={() => { selectGroup(group); setGroupPickerOpen(false) }}><span>🌎 {groupLabel(group)}</span><small>{(groupCounts.get(group) || 0).toLocaleString('pt-BR')}</small></button>)}
            </div>}
          </div>
          <div className="library-actions">{selectedGroup === 'Recentes' && recentChannels.length > 0 && <button className="heading-action" onClick={clearRecents} title="Apagar todo o histórico de canais vistos"><Trash2 size={14} /> Limpar histórico</button>}{mosaicActive && <span className="mosaic-hint"><LayoutDashboard size={13} /> Mosaico {mosaicChannels.length}/{mosaicCapacity} · clique ou arraste para uma tela</span>}<span className="count">{channels.length.toLocaleString('pt-BR')} canais</span><div className="view-toggle" role="group" aria-label="Visualização dos canais"><button aria-label="Quadrados" title="Quadrados" aria-pressed={channelView === 'grid'} onClick={() => changeChannelView('grid')}><LayoutGrid size={18} /></button><button aria-label="Lista" title="Lista" aria-pressed={channelView === 'list'} onClick={() => changeChannelView('list')}><List size={18} /></button></div><button className="yt-icon-btn yt-panel-close" onClick={() => setChannelPanelHidden(true)} title="Ocultar lista de canais" aria-label="Ocultar lista de canais"><X size={20} /></button></div>
        </div>
        
        {!showingRecommendations && <div className="channel-filters">
          <label title="Ordenar canais"><ArrowUpDown size={14} /><select value={channelSort} onChange={(event) => setChannelSort(event.target.value as ChannelSort)} aria-label="Ordenar canais">{CHANNEL_SORTS.map((value) => <option key={value} value={value}>{CHANNEL_SORT_LABELS[value]}</option>)}</select></label>
          <label title="Filtrar por qualidade"><MonitorPlay size={14} /><select value={channelQuality} onChange={(event) => setChannelQuality(event.target.value as QualityFilter)} aria-label="Qualidade">{QUALITY_FILTERS.map((value) => <option key={value} value={value}>{value === 'all' ? 'Qualidade: todas' : QUALITY_FILTER_LABELS[value]}</option>)}</select></label>
          <button className={channelOnlyFavorites === '1' ? 'active' : ''} aria-pressed={channelOnlyFavorites === '1'} onClick={() => setChannelOnlyFavorites(channelOnlyFavorites === '1' ? '0' : '1')} title="Mostrar só favoritos"><Star size={14} fill={channelOnlyFavorites === '1' ? 'currentColor' : 'none'} /> Favoritos</button>
          {(channelSort !== 'default' || channelQuality !== 'all' || channelOnlyFavorites === '1') && <button className="channel-filters-reset" onClick={() => { setChannelSort('default'); setChannelQuality('all'); setChannelOnlyFavorites('0') }}>Limpar</button>}
        </div>}
        {subgroups.length > 0 && <div className="subcategory-strip"><button className={selectedSubgroup === 'Todos' ? 'active' : ''} onClick={() => setSelectedSubgroup('Todos')}>Todos</button>{subgroups.map((subgroup) => <button key={subgroup} className={selectedSubgroup === subgroup ? 'active' : ''} onClick={() => setSelectedSubgroup(subgroup)}>{subgroup}</button>)}</div>}
        {channelView === 'list' && channels.length ? <div className="recent-list">{channels.slice(0, channelLimit).map((channel, index) => <Fragment key={channel.id}>{recommendationHeading(index)}<div className={isActiveChannel(channel) ? 'recent-row selected' : 'recent-row'} draggable onDragStart={(event) => { event.dataTransfer.setData(CHANNEL_DRAG_TYPE, JSON.stringify(channel)); event.dataTransfer.effectAllowed = 'copyMove' }}><button className="recent-main" onClick={() => selectChannel(channel)}><div className="channel-logo-mini">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={18} />}</div><div><strong>{channel.name}</strong><span>{groupLabel(channel.subgroup || channel.group)} · transmissão ao vivo</span></div></button><button className={isFavoriteChannel(channel) ? 'row-fav active' : 'row-fav'} aria-pressed={isFavoriteChannel(channel)} aria-label={isFavoriteChannel(channel) ? `Remover ${channel.name} dos favoritos` : `Favoritar ${channel.name}`} title={isFavoriteChannel(channel) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} onClick={() => toggleFavorite(channel)}><Star size={15} fill={isFavoriteChannel(channel) ? 'currentColor' : 'none'} /></button>{selectedGroup === 'Recentes' && <button className="recent-remove" aria-label={`Remover ${channel.name} dos recentes`} title="Remover dos recentes" onClick={() => removeRecent(channel)}><X size={15} /></button>}</div></Fragment>)}</div> : channels.length ? <><div className={selectedGroup === '+18' ? 'yt-grid yt-channel-grid adult-area' : 'yt-grid yt-channel-grid'}>{channels.slice(0, channelLimit).map((channel, index) => <Fragment key={channel.id}>{recommendationHeading(index)}<ChannelCard channel={channel} group={channel.subgroup || groupName(channel)} favorite={isFavoriteChannel(channel)} active={isActiveChannel(channel)} onPlay={() => selectChannel(channel)} onToggleFavorite={() => toggleFavorite(channel)} extra={selectedGroup === 'Recentes' ? <button className="yt-card-remove" aria-label={`Remover ${channel.name} dos recentes`} title="Remover dos recentes" onClick={() => removeRecent(channel)}><X size={16} /></button> : undefined} /></Fragment>)}</div></> : <div className="empty-list">{selectedGroup === '+18' ? 'Nenhum canal +18 encontrado.' : 'Nenhum canal encontrado.'}</div>}
      </section> : <section className="channels-section media-library">
        <div className="section-heading"><div><span className="eyebrow">{contentMode === 'adult' ? 'ÁREA +18' : contentMode === 'movie' ? 'FILMES' : 'SÉRIES'}</span><h2>{selectedSeries ? (selectedSeries.kind === 'movie' ? 'Detalhes do filme' : 'Detalhes da série') : contentMode === 'movie' ? 'Catálogo de filmes' : 'Catálogo de séries'}</h2></div>{!selectedSeries && <span className="count">{mediaItems.length.toLocaleString('pt-BR')} títulos</span>}</div>
        {selectedSeries ? <MediaDetails item={selectedSeries} connection={xtreamConnection} backLabel={contentMode === 'adult' ? 'Voltar à área +18' : contentMode === 'movie' ? 'Voltar aos filmes' : 'Voltar às séries'} onBack={() => setSelectedSeries(null)} onPlay={playFromDetails} /> : <MediaLibrary kind={contentMode === 'movie' ? 'movie' : 'series'} items={mediaItems} query={query} genre={selectedMediaCategory} onGenreChange={(genre) => { setSelectedMediaCategory(genre); scrollToSection('.media-library') }} onOpen={(item) => item.kind === 'movie' ? playMovie(item) : void openSeries(item)} />}
      </section>}
    {zapToast && <div className="zap-toast" role="status">{zapToast}</div>}
    {listReturn !== null && <button className="list-return" onClick={() => { const top = listReturn; setListReturn(null); window.scrollTo({ top, behavior: 'smooth' }) }}><ArrowDown size={16} /> Voltar à lista</button>}
    </main><aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
      <div className="yt-side-main">
        <button className="yt-nav" onClick={() => selectContentMode('home')}><Home size={20} /><span className="yt-nav-label">Início</span></button>
        <button className={contentMode === 'live' ? 'yt-nav active' : 'yt-nav'} onClick={() => selectContentMode('live')}><Radio size={20} /><span className="yt-nav-label">TV ao vivo</span></button>
        {playlist.media?.some((item) => item.kind === 'movie') && <button className={contentMode === 'movie' ? 'yt-nav active' : 'yt-nav'} onClick={() => selectContentMode('movie')}><Film size={20} /><span className="yt-nav-label">Filmes</span></button>}
        {playlist.media?.some((item) => item.kind === 'series') && <button className={contentMode === 'series' ? 'yt-nav active' : 'yt-nav'} onClick={() => selectContentMode('series')}><Clapperboard size={20} /><span className="yt-nav-label">Séries</span></button>}
        {hasAdultArea && <button className={contentMode === 'adult' ? 'yt-nav active adult-nav' : 'yt-nav adult-nav'} onClick={() => { selectContentMode('adult'); window.scrollTo({ top: 0 }) }}><span className="adult-nav-icon">+18</span><span className="yt-nav-label">Área +18</span></button>}
      </div>
      <div className="playlist-title"><strong>{playlist.name}</strong><span>{playlist.channels.length.toLocaleString('pt-BR')} canais · {playlist.media?.length || 0} títulos</span></div>
      <nav>
        {contentMode === 'live' && <><button className={selectedGroup === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Todos')}><Radio size={18} /><span>Todos os canais</span></button><button className={selectedGroup === 'Recentes' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Recentes')}><Clock3 size={18} /><span>Recentes</span>{recentChannels.length > 0 && <small>{recentChannels.length}</small>}</button><button className={selectedGroup === 'Favoritos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Favoritos')}><Star size={18} /><span>Favoritos</span>{favoriteChannels.length > 0 && <small>{favoriteChannels.length}</small>}</button><div className="nav-divider" /><div className="sidebar-category-mode" role="group" aria-label="Organização das categorias"><button className={categoryStyle === 'smart' ? 'active' : ''} aria-pressed={categoryStyle === 'smart'} onClick={() => changeCategoryStyle('smart')}>Inteligente</button><button className={categoryStyle === 'provider' ? 'active' : ''} aria-pressed={categoryStyle === 'provider'} onClick={() => changeCategoryStyle('provider')}>Lista IPTV</button></div><div className="category-search"><Search size={14} /><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Buscar categoria" aria-label="Buscar categoria" />{categoryQuery && <button type="button" aria-label="Limpar busca de categoria" onClick={() => setCategoryQuery('')}><X size={13} /></button>}</div>{favoriteGroupList.filter(categoryFilter).length > 0 && <><div className="nav-heading">CATEGORIAS FAVORITAS</div>{favoriteGroupList.filter(categoryFilter).map((group) => renderGroup(group, 'fav'))}<div className="nav-divider" /></>}<div className="nav-heading">{categoryStyle === 'smart' ? 'CATEGORIAS INTELIGENTES' : 'CATEGORIAS DO IPTV'}</div>{visibleGroups.filter((group) => group !== 'Internacionais' && !isForeignGroup(group)).map((group) => renderGroup(group, 'all'))}{visibleGroups.some((group) => group === 'Internacionais' || isForeignGroup(group)) && <><div className="nav-divider" /><div className="nav-heading">INTERNACIONAIS</div>{visibleGroups.filter((group) => group === 'Internacionais' || isForeignGroup(group)).map((group) => renderGroup(group, 'all'))}</>}{visibleGroups.length === 0 && <div className="nav-empty">Nenhuma categoria com “{categoryQuery}”.</div>}{adultCollapsed.length > 0 && <><div className="nav-divider" /><button className="nav-item adult-nav-item" onClick={() => { selectContentMode('adult'); window.scrollTo({ top: 0 }) }}><span className="adult-nav-icon">+18</span><span>Área +18</span></button></>}</>}
        {contentMode === 'adult' && <>
          <div className="nav-heading">ÁREA +18</div>
          {adultCatalog.tabs.map((tab) => <button key={tab} className={adultTab === tab ? 'nav-item active' : 'nav-item'} onClick={() => changeAdultTab(tab)}>{ADULT_TAB_ICONS[tab]}<span>{ADULT_TAB_LABELS[tab]}</span><small>{adultCatalog.counts[tab].toLocaleString('pt-BR')}</small></button>)}
          {adultCatalog.subgroups.length > 1 && <><div className="nav-divider" /><div className="nav-heading">SUBGRUPOS</div>
            <button className={adultSubgroup === 'Todos' ? 'nav-item nav-genre active' : 'nav-item nav-genre'} onClick={() => changeAdultSubgroup('Todos')}><LayoutGrid size={17} /><span>Todos</span><small>{adultCatalog.total.toLocaleString('pt-BR')}</small></button>
            {adultCatalog.subgroups.map(([name, count]) => <button key={name} title={name} className={adultSubgroup === name ? 'nav-item nav-genre active' : 'nav-item nav-genre'} onClick={() => changeAdultSubgroup(name)}>{ADULT_TAB_ICONS[adultTab]}<span>{name}</span><small>{count.toLocaleString('pt-BR')}</small></button>)}
          </>}
        </>}
        {(contentMode === 'movie' || contentMode === 'series') && <><button className="nav-item" onClick={() => selectContentMode(contentMode === 'movie' ? 'live' : 'movie')}>{contentMode === 'movie' ? <Radio size={18} /> : <Film size={18} />}<span>{contentMode === 'movie' ? 'TV ao vivo' : 'Filmes'}</span></button><button className="nav-item" onClick={() => selectContentMode(contentMode === 'series' ? 'live' : 'series')}>{contentMode === 'series' ? <Radio size={18} /> : <Clapperboard size={18} />}<span>{contentMode === 'series' ? 'TV ao vivo' : 'Séries'}</span></button><div className="nav-divider" /><div className="nav-heading">GÊNEROS</div><button className={selectedMediaCategory === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => { setSelectedMediaCategory('Todos'); setSelectedSeries(null); setSidebarOpen(false) }}><LayoutGrid size={17} /><span>Início</span></button>{myListCount > 0 && <button className={selectedMediaCategory === MY_LIST ? 'nav-item nav-genre active' : 'nav-item nav-genre'} onClick={() => { setSelectedMediaCategory(MY_LIST); setSelectedSeries(null); setSidebarOpen(false); scrollToSection('.media-library') }}><Bookmark size={17} /><span>{MY_LIST}</span><small>{myListCount.toLocaleString('pt-BR')}</small></button>}{mediaGenres.map(({ genre, count }) => <button key={genre} className={selectedMediaCategory === genre ? 'nav-item nav-genre active' : 'nav-item nav-genre'} title={genre} onClick={() => { setSelectedMediaCategory(genre); setSelectedSeries(null); setSidebarOpen(false); scrollToSection('.media-library') }}><Film size={17} /><span>{genre}</span><small>{count.toLocaleString('pt-BR')}</small></button>)}</>}
      </nav>
    </aside>{sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}</div>
    {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={groups.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
  </div></EpgConnectionContext.Provider>
}
