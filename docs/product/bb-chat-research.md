# BB as a reference for Chelaro's chat

Inspected 2026-09-05, upstream `get-bb/bb` commit
`0c3ba712a0c86639a6cf0a445cf9f2062ef5e439`. Chelaro implements the interaction patterns independently;
no BB source code or assets were copied.

| BB source | Pattern | Chelaro adaptation |
| --- | --- | --- |
| [EmbeddedThreadChat](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/thread/embedded-chat/EmbeddedThreadChat.tsx) | Contained chat, bottom-anchored scrolling, separate footer | Viewport-sized chat with a docked composer and reader-controlled scroll following |
| [PromptBoxInternal](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/promptbox/PromptBoxInternal.tsx) | Rounded input surface with compact controls in its footer | Model and reasoning controls inside the composer, send/stop in the lower-right corner |
| [NewThreadComposer](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/promptbox/NewThreadComposer.tsx) | Draft state and execution settings are part of conversation creation | Start on the first question, preserve the draft on failure, bind the verified selection |
| [AppLayoutSidebar](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/layout/AppLayoutSidebar.tsx) | Navigation and threads belong to the application frame | Finance navigation and searchable conversations share one sidebar |
| [ConversationMessageContent](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/thread/timeline/ConversationMessageContent.tsx) | Readable message content instead of a wall of plain text | Markdown tables/lists, restrained user messages, open assistant prose |

Chelaro keeps its own colors, typography, consent, and financial safety boundaries. BB's agent
orchestration, file attachment execution, shell tools, and automatic follow-up queues are outside
this change. A draft written during a running answer is never sent automatically.

Markdown rendering uses [react-markdown](https://github.com/remarkjs/react-markdown#security) with
raw HTML disabled, HTTP(S)-only links, and image rendering replaced by inert alternative text.
The existing message size bound and digest verification remain in the transport.
