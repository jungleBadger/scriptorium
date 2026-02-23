<script setup>
import { computed, ref, watch } from 'vue'
import { PT_BR_BOOK_NAMES } from '../data/bookNamesPtBr.js'
import Icon from './ui/Icon.vue'

const props = defineProps({
  books:          { type: Array,  default: () => [] },
  currentBookId:  { type: String, default: '' },
  currentChapter: { type: Number, default: 1 },
  translation:    { type: String, default: 'WEBU' },
})

const emit = defineEmits(['navigate', 'close'])

// ── Testament boundary ────────────────────────────────────────────────────
// PT_BR_BOOK_NAMES lists 66 books in canonical order; first 39 OT, last 27 NT.
const ALL_IDS = Object.keys(PT_BR_BOOK_NAMES)
const NT_IDS  = new Set(ALL_IDS.slice(39))

// ── LocalStorage ──────────────────────────────────────────────────────────
const LS_RECENT = 'scriptorium-library-recent'
const LS_PINNED = 'scriptorium-library-pinned'

function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback }
  catch { return fallback }
}

const recentIds  = ref(readLS(LS_RECENT, []))
const pinnedIds  = ref(readLS(LS_PINNED, []))

function saveRecent() { localStorage.setItem(LS_RECENT, JSON.stringify(recentIds.value)) }
function savePinned() { localStorage.setItem(LS_PINNED, JSON.stringify(pinnedIds.value)) }

// ── Search ────────────────────────────────────────────────────────────────
const searchQuery = ref('')

function matchBook(book) {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return true
  const name = (book.displayName || book.name || '').toLowerCase()
  const id   = (book.book_id || '').toLowerCase()
  return name.includes(q) || id.includes(q)
}

// ── Testament groups ──────────────────────────────────────────────────────
const otOpen = ref(true)
const ntOpen = ref(true)

const otBooks = computed(() => props.books.filter(b => !NT_IDS.has(b.book_id) && matchBook(b)))
const ntBooks = computed(() => props.books.filter(b =>  NT_IDS.has(b.book_id) && matchBook(b)))

// Auto-expand groups when searching
watch(searchQuery, (q) => {
  if (q) { otOpen.value = true; ntOpen.value = true }
})

// ── Recent / Pinned books (resolved from books array) ─────────────────────
const recentBooks = computed(() =>
  recentIds.value
    .map(id => props.books.find(b => b.book_id === id))
    .filter(Boolean)
    .slice(0, 6)
)
const pinnedBooks = computed(() =>
  pinnedIds.value
    .map(id => props.books.find(b => b.book_id === id))
    .filter(Boolean)
)

// ── Chapter picker ────────────────────────────────────────────────────────
// null = show book list, string = show chapter picker for that book_id
const pickerBookId = ref(null)

const pickerBook = computed(() =>
  pickerBookId.value ? props.books.find(b => b.book_id === pickerBookId.value) : null
)

const chapterList = computed(() =>
  Array.from({ length: pickerBook.value?.chapters || 0 }, (_, i) => i + 1)
)

// Sync picker to current book on first load
watch(() => props.currentBookId, (id) => {
  if (!pickerBookId.value && id) pickerBookId.value = id
}, { immediate: true })

// ── Actions ───────────────────────────────────────────────────────────────
function openPicker(book) {
  pickerBookId.value = book.book_id
  addRecent(book.book_id)
}

function closePicker() {
  pickerBookId.value = null
}

function navigateTo(bookId, chapter) {
  addRecent(bookId)
  emit('navigate', { bookId, chapter })
}

function addRecent(bookId) {
  const list = [bookId, ...recentIds.value.filter(id => id !== bookId)].slice(0, 10)
  recentIds.value = list
  saveRecent()
}

function removeRecent(bookId) {
  recentIds.value = recentIds.value.filter(id => id !== bookId)
  saveRecent()
}

function clearRecent() {
  recentIds.value = []
  saveRecent()
}

function togglePin(bookId) {
  const s = new Set(pinnedIds.value)
  s.has(bookId) ? s.delete(bookId) : s.add(bookId)
  pinnedIds.value = [...s]
  savePinned()
}

function isPinned(bookId) { return pinnedIds.value.includes(bookId) }
</script>

<template>
  <div class="library-sidebar">
    <!-- Header -->
    <header class="library-header">
      <h2 class="library-title">Library</h2>
      <button
        class="nav-icon-btn group"
        type="button"
        aria-label="Close Library"
        @click="emit('close')"
      >
        <Icon
          name="X"
          :size="20"
          class="text-neutral-600 transition-colors group-hover:text-neutral-900"
          aria-hidden="true"
        />
      </button>
    </header>

    <!-- Search -->
    <div class="library-search">
      <div class="library-search-field">
        <Icon
        name="Search"
        :size="18"
        class="library-search-icon text-neutral-600"
        aria-hidden="true"
      />
        <input
        v-model="searchQuery"
        type="search"
        class="library-search-input library-search-input--with-icon"
        placeholder="Search books…"
        aria-label="Search books"
      />
      </div>
    </div>

    <!-- Chapter Picker -->
    <div v-if="pickerBook" class="library-picker">
      <div class="library-picker-header">
        <button class="library-picker-back nav-icon-btn flex items-center gap-2" type="button" @click="closePicker">
          <Icon name="ChevronLeft" :size="16" class="text-neutral-600" aria-hidden="true" />
          <span>Books</span>
        </button>
        <span class="library-picker-title">{{ pickerBook.displayName || pickerBook.name }}</span>
        <button
          class="library-pin-btn nav-icon-btn"
          type="button"
          :aria-pressed="isPinned(pickerBook.book_id)"
          :title="isPinned(pickerBook.book_id) ? 'Unpin book' : 'Pin book'"
          @click="togglePin(pickerBook.book_id)"
        >
          {{ isPinned(pickerBook.book_id) ? '★' : '☆' }}
        </button>
      </div>
      <div class="library-scroll-region">
        <div class="library-chapter-grid" role="list" :aria-label="`Chapters of ${pickerBook.displayName || pickerBook.name}`">
          <button
            v-for="ch in chapterList"
            :key="ch"
            class="library-chapter-btn"
            :class="{
              'library-chapter-btn--active': pickerBook.book_id === currentBookId && ch === currentChapter,
            }"
            type="button"
            role="listitem"
            :aria-label="`Chapter ${ch}`"
            :aria-current="pickerBook.book_id === currentBookId && ch === currentChapter ? 'true' : undefined"
            @click="navigateTo(pickerBook.book_id, ch)"
          >
            {{ ch }}
          </button>
        </div>
      </div>
    </div>

    <!-- Book List -->
    <div v-else class="library-scroll-region">
      <div class="library-books">
      <!-- Pinned -->
      <div v-if="!searchQuery && pinnedBooks.length" class="library-section">
        <p class="library-section-label">Pinned</p>
        <ul class="library-book-list">
          <li v-for="book in pinnedBooks" :key="book.book_id">
            <button
              class="library-book-btn"
              :class="{ 'library-book-btn--active': book.book_id === currentBookId }"
              type="button"
              @click="openPicker(book)"
            >
              {{ book.displayName || book.name }}
            </button>
          </li>
        </ul>
      </div>

      <!-- Recent -->
      <div v-if="!searchQuery && recentBooks.length" class="library-section">
        <div class="library-section-head">
          <p class="library-section-label">Recent</p>
          <button
            class="library-clear-recent-btn"
            type="button"
            @click="clearRecent"
          >
            Clear
          </button>
        </div>
        <ul class="library-book-list">
          <li v-for="book in recentBooks" :key="book.book_id">
            <div class="library-recent-row">
              <button
                class="library-book-btn"
                :class="{ 'library-book-btn--active': book.book_id === currentBookId }"
                type="button"
                @click="openPicker(book)"
              >
                {{ book.displayName || book.name }}
              </button>
              <button
                class="library-recent-remove-btn"
                type="button"
                :aria-label="`Remove ${book.displayName || book.name} from recent`"
                title="Remove from recent"
                @click.stop="removeRecent(book.book_id)"
              >
                &times;
              </button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Old Testament -->
      <div v-if="otBooks.length" class="library-testament">
        <button
          class="library-testament-toggle"
          type="button"
          :aria-expanded="otOpen"
          @click="otOpen = !otOpen"
        >
          <span>Old Testament</span>
          <Icon
            name="ChevronRight"
            :size="16"
            class="library-chevron text-neutral-600"
            :class="{ 'library-chevron--open': otOpen }"
            aria-hidden="true"
          />
        </button>
        <ul v-show="otOpen" class="library-book-list library-book-list--testament">
          <li v-for="book in otBooks" :key="book.book_id">
            <button
              class="library-book-btn"
              :class="{ 'library-book-btn--active': book.book_id === currentBookId }"
              type="button"
              @click="openPicker(book)"
            >
              {{ book.displayName || book.name }}
            </button>
          </li>
        </ul>
      </div>

      <!-- New Testament -->
      <div v-if="ntBooks.length" class="library-testament">
        <button
          class="library-testament-toggle"
          type="button"
          :aria-expanded="ntOpen"
          @click="ntOpen = !ntOpen"
        >
          <span>New Testament</span>
          <Icon
            name="ChevronRight"
            :size="16"
            class="library-chevron text-neutral-600"
            :class="{ 'library-chevron--open': ntOpen }"
            aria-hidden="true"
          />
        </button>
        <ul v-show="ntOpen" class="library-book-list library-book-list--testament">
          <li v-for="book in ntBooks" :key="book.book_id">
            <button
              class="library-book-btn"
              :class="{ 'library-book-btn--active': book.book_id === currentBookId }"
              type="button"
              @click="openPicker(book)"
            >
              {{ book.displayName || book.name }}
            </button>
          </li>
        </ul>
      </div>

        <div v-if="searchQuery && !otBooks.length && !ntBooks.length" class="state-text library-empty">
          No books match "{{ searchQuery }}"
        </div>
      </div>
    </div>
  </div>
</template>
