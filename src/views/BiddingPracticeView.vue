<template>
  <!-- ══ Server mode: live table-service seat / kibitz view (ServerEngine) ══ -->
  <template v-if="server">
    <div v-if="srv.sessionClosed" class="tv-closed-card">
      <h2>Session ended</h2>
      <p>The teacher has ended this table session. Thanks for playing!</p>
      <button class="tv-btn tv-btn-primary" @click="emit('exit')">Back to the lobby</button>
    </div>

    <TableShell
        :table-config="tableConfig" v-else>
      <template #header-left>
          <!-- Board number and the contract/result chips were REMOVED here
               2026-07-29: NW already carries both — the BoardIndicator glyph IS the
               board number, and the StatusStrip under it IS the contract/result. The
               header was showing the same two facts a second time, a few hundred
               pixels away. What stays is what NW does NOT say: the table's name, the
               bot backend, and the all-hands toggle. -->
          <span class="tv-title">{{ srv.tableTitle }}</span>
          <span
            v-if="srv.botMode"
            class="tv-tag tv-tag-bots"
            title="Empty seats are played by practice bots"
          >
            {{ srv.botMode === 'random' ? 'practice bots' : 'bots: ' + srv.botMode }}
          </span>
          <button
            v-if="srv.canToggleHands"
            class="tv-tag tv-tag-toggle"
            :title="srv.showAllHands
              ? 'Teacher view: all hands visible. Click to see only what a player would.'
              : 'Player view: hidden hands stay hidden. Click to reveal all hands.'"
            @click="srv.toggleShowAllHands"
          >
            {{ srv.showAllHands ? '👁 all hands' : '👁 my view' }}
          </button>
      </template>

      <template #header-right>
          <span class="tv-conn" :class="'tv-conn-' + srv.connectionStatus">
            {{ srv.connectionLabel }}
          </span>
          <button
            v-if="srv.canManageSeats"
            class="tv-btn"
            :class="{ 'tv-btn-active': srv.botsPaused }"
            :disabled="srv.connectionStatus !== 'connected'"
            :title="srv.botsPaused
              ? 'Bots are paused — click to resume play'
              : 'Pause all bots, then Undo steps back through bot actions'"
            @click="srv.onPauseBots(!srv.botsPaused)"
          >
            {{ srv.botsPaused ? '▶ Resume bots' : '⏸ Pause bots' }}
          </button>
          <button
            class="tv-btn"
            :disabled="srv.seq === 0 || srv.connectionStatus !== 'connected' || (!srv.hasHumanSeat && !srv.botsPaused)"
            :title="srv.botsPaused
              ? 'Step back one action (bots paused)'
              : (srv.hasHumanSeat
                ? 'Rewind to your last decision (bots replay up to your turn)'
                : 'Nothing to undo — pause bots to step back through bot actions')"
            @click="srv.onUndo"
          >
            Undo
          </button>
          <DealSourceButton
            v-if="srv.canDeal"
            :disabled="srv.connectionStatus !== 'connected'"
            @open="srv.dealModalOpen = true"
          />
          <button
            v-if="srv.canDeal"
            class="tv-btn tv-btn-primary"
            :disabled="srv.connectionStatus !== 'connected' || srv.dealSource.dealing"
            :title="'Deal the next board from: ' + srv.dealSource.label()"
            @click="srv.onNextDeal"
          >
            Next deal
          </button>
          <button
            v-if="srv.canHostAdvance"
            class="tv-btn tv-btn-primary"
            :disabled="srv.connectionStatus !== 'connected'"
            title="Move everyone to the next board now (host)"
            @click="srv.onHostNextDeal"
          >
            Next deal →
          </button>
      </template>

      <template #notes>
        <!-- Seat identity now renders above each hand (BridgeTable occupants); the
             old seats strip is gone from this view. -->
        <p v-if="!srv.yourSeat && !srv.seeAll" class="tv-kibitz-note">
          You're kibitzing — watching all four hands. The host can seat you.
        </p>
        <p v-if="srv.pausedSeat" class="tv-paused-note">
          ⏸ Paused — {{ srv.pausedLabel }}.
        </p>
      </template>

      <template #table>
          <!-- Phase: pass the engine phase THROUGH, review included (srv.phase reports
               'complete' for review, so only that one name is mapped). It used to be
               collapsed to a bidding/play ternary — see the solo branch for why that
               reserved auction-growth height on a finished auction. -->
          <SeatControlTable
            arrangement="grid"
            :table-config="tableConfig"
            :region-reserves="srvRegionReserves"
            :phase="srv.phase === 'complete' ? 'review' : srv.phase"
            :hero-seat="srv.yourSeat || 'S'"
            :hands="srv.displayHands"
            :hidden-seats="srv.displayHiddenSeats"
            :identity-only="!srv.dealLoaded"
            :occupants="srv.seatOccupants"
            :active-seat="srv.botThinking ? null : srv.nextToAct"
            :thinking-seat="srv.botThinking ? srv.nextToAct : null"
            :show-hcp="false"
            :clickable-seat="srv.clickableSeat"
            :hide-played-cards="true"
            :seats="srv.seats"
            :your-seats="srv.yourSeats"
            :my-token="srv.myToken"
            :can-manage="srv.canManageSeats"
            :roster="srv.roster"
            :session-id="srv.sessionId"
            @card-click="srv.onCardClick"
            @assign="srv.onAssignSeat"
            @kick="srv.onKick"
          >
            <!-- NW: board status + the deal transport, same components and same
                 corner as the solo table (2026-07-29 relocation). The transport is
                 OWNER-ONLY here — `srv.canDeal` is false for an invited player, so
                 B3's corner renders the glyph alone and reserves nothing for
                 buttons that seat never gets. -->
            <template #nw>
              <div class="tv-grid-nw">
                <BoardIndicator
                  v-if="srv.boardNumber !== null"
                  :board-number="srv.boardNumber"
                  :dealer="srv.dealer || null"
                  :vulnerable="srv.vulnerable || null"
                  :size="A1_BOARD_SIZE"
                />
                <StatusStrip v-if="srvCenterSlot === 'trick-area' || srvCenterSlot === 'review'" :status="srvStatus" :show-vul="false" />
                <DealControls
                  v-if="srv.canDeal || srv.canHostAdvance"
                  :show-restart="false"
                  :show-next="srv.canDeal || srv.canHostAdvance"
                  :can-next="srv.connectionStatus === 'connected' && !srv.dealSource.dealing"
                  @next="srv.canHostAdvance ? srv.onHostNextDeal() : srv.onNextDeal()"
                />
              </div>
            </template>

            <!-- CENTER: live auction (bidding) / trick (play) / no-deal notice. -->
            <template #center>
              <TrickArea
                v-if="srv.dealLoaded && (srvCenterSlot === 'trick-area' || srvCenterSlot === 'review')"
                :current-trick="srv.currentTrick"
                :last-finished-trick="srv.lastFinishedTrick"
                :tricks-taken="srv.tricksTaken"
                :next-seat="srv.nextToAct"
                :bot-loading="srv.botThinking"
                bot-name="Bot"
              />
              <AuctionTable
                v-else-if="srv.dealLoaded && srvCenterSlot === 'auction'"
                :bids="srv.auction"
                :dealer="srv.dealer || 'N'"
                :current-bid-index="srv.auction.length"
                :show-turn-indicator="srv.phase === 'bidding'"
              />
              <div v-else-if="!srv.dealLoaded" class="tv-center">
                <div class="tv-center-line">No deal yet</div>
                <div class="tv-center-line tv-center-muted">Pick a deal source</div>
              </div>
            </template>

            <!-- NE: completed auction pinned through play AND review (config
                 densities.play.ne). At review it carries the per-seat BBA
                 comparison (you-vs-BBA), read-only — no toggle on a shared table. -->
            <template v-if="srv.dealLoaded && (srvCenterSlot === 'trick-area' || srvCenterSlot === 'review')" #ne>
              <AuctionTable
                :bids="srv.auction"
                :dealer="srv.dealer || 'N'"
                :current-bid-index="srv.auction.length"
                :diverged-bids="srv.divergedBids"
                :show-turn-indicator="false"
                :allow-divergence-toggle="false"
              />
            </template>

            <!-- SE — the action corner, mirroring the solo table (2026-07-29):
                 bidding box with Undo underneath, then the double-dummy table at
                 review. Undo is host-gated (the served Undo rewinds shared state),
                 so a guest sees the box alone. No Claim on a served table — claiming
                 is a solo-cardplay affordance today. -->
            <template v-if="srvSeSlot" #se>
              <div class="tv-se-stack">
                <BiddingBox
                  v-if="srvSeSlot === 'bidding'"
                  :last-bid="srv.lastSuitBid"
                  :can-double="srv.canDouble"
                  :can-redouble="srv.canRedouble"
                  :disabled="srvActionSlot !== 'bidding-box'"
                  @bid="srv.onBid"
                />
                <DoubleDummyTable
                  v-else-if="srvSeSlot === 'double-dummy'"
                  compact
                  :ddtricks="srv.doubleDummy"
                  :final-contract="srv.ddFinalContract"
                />
                <ActionCluster
                  v-if="srvSeSlot !== 'double-dummy' && srv.canManageSeats"
                  :can-undo="srv.seq !== 0 && srv.connectionStatus === 'connected' && (srv.hasHumanSeat || srv.botsPaused)"
                  :bot-status="srv.botThinking ? 'Bot thinking… (up to ~20s)' : null"
                  @undo="srv.onUndo"
                />
              </div>
            </template>
          </SeatControlTable>
      </template>

      <template #rail>
          <!-- Auction + bidding box live in the grid (centre/NE, and SE); the
               double-dummy table joined them in SE at review (2026-07-29), so the
               rail keeps only the host controls + the off-turn waiting cues.
               Every card is a RailCard — one frame, one name, one CSS home; they
               were eight ad-hoc divs in two namespaces before 2026-07-29. -->

          <RailCard v-if="srv.dealLoaded && srv.phase === 'bidding' && srv.boardMode === 'play-only'" tone="waiting">
            Play-only board — the auction is bid automatically…
          </RailCard>

          <RailCard v-else-if="srv.yourSeat && (!srv.dealLoaded || srv.phase === 'bidding')">
            <div v-if="!srv.dealLoaded" class="tv-status-line tv-waiting tv-bid-waiting">
              Waiting for the first deal…
            </div>
            <div v-else-if="srv.myTurnToBid" class="tv-status-line tv-your-turn">Your bid — use the box on the table.</div>
            <div v-else-if="srv.nextToAct" class="tv-status-line tv-waiting tv-bid-waiting">
              Waiting for {{ srv.turnLabel }}…
            </div>
          </RailCard>

          <RailCard v-else-if="srv.dealLoaded && srv.phase === 'bidding' && srv.nextToAct" tone="waiting">
            Waiting for {{ srv.turnLabel }}…
          </RailCard>

          <!-- Kibitz box: who's watching; the host drags labels here to unseat,
               and drags a kibitzer onto a seat to seat them. -->
          <RailCard v-if="srv.canManageSeats || srv.kibitzers.length">
            <KibitzBox :kibitzers="srv.kibitzers" :can-manage="srv.canManageSeats" @assign="srv.onAssignSeat" />
          </RailCard>

          <!-- PassBot: make a side's bots always pass (BBO-style bidding
               practice). Cardplay still uses the room's cardplay bot. -->
          <RailCard v-if="srv.canManageSeats" title="PassBot" class="tv-passbot">
            <div class="tv-passbot-hint">Bots on a “pass” side never bid (cardplay unaffected).</div>
            <label class="tv-passbot-row">
              <input type="checkbox" :checked="srv.passSides.includes('NS')" @change="srv.togglePassSide('NS')">
              N/S always pass
            </label>
            <label class="tv-passbot-row">
              <input type="checkbox" :checked="srv.passSides.includes('EW')" @change="srv.togglePassSide('EW')">
              E/W always pass
            </label>
          </RailCard>

          <RailCard v-if="srv.dealLoaded && srv.phase === 'play'" title="Play">
            <div class="tv-status-line">
              Tricks <strong>NS {{ srv.tricksTaken.NS }} · EW {{ srv.tricksTaken.EW }}</strong>
            </div>
            <div v-if="srv.clickableSeat" class="tv-status-line tv-your-turn">
              Your turn — play from
              {{ srv.clickableSeat === srv.yourSeat ? 'your hand'
                : srv.clickableSeat === srv.dummySeat ? 'dummy' : "declarer's hand" }}.
            </div>
            <div v-else-if="srv.nextToAct" class="tv-status-line">
              Waiting for {{ srv.turnLabel }}…
              <span v-if="srv.botThinking" class="tv-bot-note">(bots can take up to ~20s)</span>
            </div>
          </RailCard>

          <!-- BBA auction comparison toggle (your-seat you-vs-BBA overlay). A
               per-viewer table setting; the overlay is scoped to your own seat,
               so it's shown once you're seated and the auction has settled. -->
          <RailCard
            v-if="srv.capabilities.divergence && srv.yourSeat && srv.dealLoaded && (srvCenterSlot === 'trick-area' || srvCenterSlot === 'review')"
          >
            <label class="tv-passbot-row" title="Compare your bids to the BBA expected auction in the auction grid.">
              <input type="checkbox" :checked="srv.showBbaCompare" @change="srv.toggleBbaCompare()">
              Show BBA auction comparison
            </label>
          </RailCard>

          <RailCard v-if="srv.dealLoaded && srv.phase === 'complete'" title="Result">
            <div class="tv-status-line tv-result-line">
              <span v-if="srv.resultBanner" v-html="srv.resultBanner"></span>
              <template v-else-if="srv.contract">
                <span v-html="srv.contractHtml"></span> by {{ srv.declarer }} —
                declarer took {{ srv.declarerTricks }} trick{{ srv.declarerTricks === 1 ? '' : 's' }}.
              </template>
              <template v-else>Passed out.</template>
            </div>
            <div class="tv-status-line">
              Tricks <strong>NS {{ srv.tricksTaken.NS }} · EW {{ srv.tricksTaken.EW }}</strong>
            </div>

            <template v-if="srv.sessionId && srv.yourSeat">
              <button
                class="tv-btn tv-btn-primary tv-ready-btn"
                :disabled="srv.iAmReady || srv.connectionStatus !== 'connected'"
                @click="srv.onReady"
              >
                {{ srv.iAmReady ? 'Ready ✓' : 'Ready for next board' }}
              </button>
              <div v-if="srv.readySeats.length" class="tv-status-line tv-ready-line">
                Ready: {{ srv.readyNames }}
              </div>
              <div v-if="srv.iAmReady" class="tv-status-line tv-ready-wait">
                Waiting for the others — or for the teacher to open the next board.
              </div>
            </template>
          </RailCard>
      </template>

      <template #overlays>
        <DealSourceModal v-if="srv.dealModalOpen" @close="srv.dealModalOpen = false" />
        <transition name="tv-fade">
          <div v-if="srv.errorMessage" class="tv-toast tv-toast-error">{{ srv.errorMessage }}</div>
        </transition>
        <transition name="tv-fade">
          <div v-if="srv.undoBy" class="tv-toast">{{ srv.undoBy }} undid the last action</div>
        </transition>

        <TableDiagnostics v-if="srv.showDiagnostics" />
      </template>
    </TableShell>
  </template>

  <!-- ══ Solo mode: the practice bidding shell (LocalEngine) ══ -->
  <div v-else class="bp-app" :class="{ embedded: EMBEDDED, 'intro-open': chatReserved }" :style="{ '--intro-gutter': chatGutter }">
    <nav v-if="!EMBEDDED" class="bp-nav">
      <a class="bp-logo" href="/"><span class="suit">&spades;</span> Bridge Classroom &middot; Bidding Practice</a>
      <!-- Account circle — same identity menu as the main app / host table. -->
      <button
        v-if="currentUser"
        class="user-btn"
        :title="userName"
        @click="showSettings = true"
      >{{ userInitials }}</button>
    </nav>

    <div class="bp-main">
      <main class="bp-stage">
        <TableShell
        :table-config="tableConfig" :embedded="EMBEDDED">
          <template #notes>
        <div v-if="dealError" class="bp-error-box">
          <strong>Error:</strong> {{ dealError }}
          <div v-if="dealErrorHint" class="bp-error-hint">{{ dealErrorHint }}</div>
        </div>

        <!-- Control strip — shown for the whole session (non-embedded), and in
             embedded mode once a deal is up. Bot + toggles are usable before a
             deal source is picked; deal-dependent buttons (Next deal / Restart /
             Description) stay greyed until a deal loads, and the Deal source
             button is spotlighted while there's no deal yet. -->
        <ScenarioBar
          v-if="currentDeal || !EMBEDDED"
          :name="currentDeal ? scenarioNameNoBoard : 'No deal yet'"
          :meta="scenarioMetaLines"
          :embedded="EMBEDDED"
        >
          <template #actions>
            <DealSourceButton
              v-if="!EMBEDDED"
              :attention="!currentDeal"
              :disabled="drawing"
              @open="showPicker = true"
            />
            <button
              v-if="!EMBEDDED"
              class="bp-btn"
              title="Turn this into a shared table you can invite friends to (converts to a served table with your current deal source)"
              @click="inviteFriends"
            >Invite friends&hellip;</button>
            <button v-if="!EMBEDDED && capabilities.narrative" class="bp-btn" @click="showScenarioChat = true" :disabled="!scenarioChat" title="Show the scenario description">Description</button>
            <span class="bp-actions-spacer"></span>
            <button v-if="!EMBEDDED" class="bp-btn bp-settings-btn" @click="showTableSettings = true" title="Table setup + cardplay options">&#9881; Table settings</button>
          </template>
        </ScenarioBar>
          </template>

          <template #table>

        <!-- No deal yet: the REAL table in identity-only mode (named seat chips,
             no hands), so the empty state matches the live layout — not a faked
             auction/bidding-box rail (which put them in the wrong place). -->
        <div v-if="!currentDeal && !EMBEDDED" class="bp-empty-table">
          <BridgeTable
            arrangement="grid"
            :table-config="tableConfig"
            :hero-seat="yourSeat"
            :hands="{ N: null, E: null, S: null, W: null }"
            :identity-only="true"
            :occupants="soloOccupants"
          />
        </div>

        <template v-if="currentDeal">
          <!-- DD review banner: which trick is recoloured on the table below. -->
          <div v-if="inspectInfo" class="bp-review-banner">
            <span><strong>Trick {{ inspectInfo.trickNo }}</strong> — {{ inspectInfo.seat }} played {{ cardLabel(inspectInfo.card) }}</span>
            <span v-if="inspectInfo.cost > 0" class="bp-review-bad">gave away {{ inspectInfo.cost }} trick<span v-if="inspectInfo.cost > 1">s</span></span>
            <span v-else-if="inspectInfo.cost === 0" class="bp-review-good">double-dummy best</span>
            <span class="bp-review-hint">click any card to return</span>
          </div>
          <!-- One layout for solo AND embedded (iframe ?pbn) bidding: the grid
               arranger. The embed is just this table in a narrower frame — the
               shell collapses the rail below the table at embed widths. -->
          <div class="bp-table-wrap">
            <!-- Phase: pass the ENGINE phase through, review included. It used to be
                 collapsed to a two-way bidding/play ternary, which meant a BIDDING-ONLY
                 review (auction finished, hand never played → hasCardplay false →
                 centerSlot null) fell through to 'bidding', so the stage reserved AUCTION
                 GROWTH height for an auction that was already over (2026-07-29 beetle
                 report). The arranger already handles 'review' properly — shrinkWrapRows
                 collapses the rows to content, deliberately WITHOUT the bottom-pack
                 margins and growth reserve that play gets — so passing it through is both
                 the fix and what the harness scenes already did.

                 Centre CONTENT is unchanged and stays decided by the slot, per Rick
                 (2026-07-29): a bidding-only review KEEPS the auction centre-stage,
                 because that is where it sat during the auction and there is no reason to
                 move it; a played review moves it to NE, because the centre was holding
                 the cardplay. -->
            <BridgeTable
              arrangement="grid"
              :table-config="tableConfig"
              :region-reserves="localRegionReserves"
              :phase="enginePhase"
              :hero-seat="yourSeat"
              :hands="visibleHands"
              :hidden-seats="hiddenSeats"
              :occupants="soloOccupants"
              :show-hcp="true"
              :show-total-points="true"
              :clickable-seat="cardplay.clickableSeat.value"
              :thinking-seat="cardplayThinkingSeat"
              :played-cards="revealPlayedCards"
              :card-badges="ddCardBadges"
              :inspectable="ddInspectEnabled"
              :hide-played-cards="cardplayHidePlayed"
              @card-click="onCardClick"
              @card-inspect="onCardInspect"
            >
              <!-- NW: board status (BoardIndicator glyph + StatusStrip) and, under
                   it, the deal transport — relocated here 2026-07-29 because the
                   board number already lives in this corner. -->
              <template #nw>
                <div class="tv-grid-nw">
                  <BoardIndicator
                    :board-number="localBoardNumber || 1"
                    :dealer="currentDeal.dealer || null"
                    :vulnerable="currentDeal.vulnerable || null"
                    :size="A1_BOARD_SIZE"
                  />
                  <StatusStrip v-if="localCenterSlot === 'trick-area' || localCenterSlot === 'review'" :status="localStatus" :show-vul="false" />
                  <DealControls
                    :can-restart="!!currentDeal && !auctionLoading"
                    :show-next="!EMBEDDED"
                    :can-next="!!currentDeal && !auctionLoading && !drawing && hasSelection"
                    :show-restart-cardplay="cardplayPhase === 'complete'"
                    :can-restart-cardplay="!cardplay.botLoading.value"
                    @restart="resetAuction"
                    @next="newDeal"
                    @restart-cardplay="restartCardplay"
                  />
                </div>
              </template>
              <!-- CENTER: live auction (bidding) / trick (play). -->
              <template #center>
                <TrickArea
                  v-if="localCenterSlot === 'trick-area' || localCenterSlot === 'review'"
                  :current-trick="centerTrick"
                  :last-finished-trick="centerLastTrick"
                  :tricks-taken="cardplay.tricksTaken.value"
                  :next-seat="centerNextSeat"
                  :bot-loading="inspecting ? false : cardplay.botLoading.value"
                  :bot-name="botName"
                />
                <AuctionTable
                  v-else
                  :bids="bids"
                  :dealer="currentDeal.dealer"
                  :current-bid-index="bids.length"
                  :wrong-bid-indices="shownWrongIndices"
                  :show-turn-indicator="!auctionComplete"
                  :meanings="meanings"
                  :diverged-bids="shownDivergedBids"
                  :allow-divergence-toggle="!auctionLoading"
                  @toggle-bid="toggleDivergedBid"
                />
              </template>
              <!-- NE: completed auction pinned during play. -->
              <template v-if="localCenterSlot === 'trick-area' || localCenterSlot === 'review'" #ne>
                <AuctionTable
                  :bids="bids"
                  :dealer="currentDeal.dealer"
                  :current-bid-index="bids.length"
                  :wrong-bid-indices="shownWrongIndices"
                  :meanings="meanings"
                  :diverged-bids="shownDivergedBids"
                  :show-turn-indicator="false"
                  :allow-divergence-toggle="false"
                />
              </template>
              <!-- SE — the action corner, which GridArrangement rides on the hero's
                   bottom. Three states (2026-07-29 relocation):
                     bidding  → BiddingBox, with Undo underneath it
                     cardplay → Undo + Claim side by side (the old rail panel's job)
                     review   → the double-dummy table
                   The claim FORM renders under the cluster while open — it's a
                   transient sub-mode of the Claim button, so it belongs where the
                   button is, not back in the rail. -->
              <template v-if="seSlot" #se>
                <div class="bp-se-stack">
                  <BiddingBox
                    v-if="seSlot === 'bidding'"
                    :last-bid="lastNonPassNonDouble"
                    :can-double="canDouble"
                    :can-redouble="canRedouble"
                    :disabled="localActionSlot !== 'bidding-box' || auctionLoading"
                    @bid="onUserBid"
                  />
                  <DoubleDummyTable
                    v-else-if="seSlot === 'double-dummy'"
                    compact
                    :ddtricks="doubleDummy"
                    :final-contract="finalContract"
                    :diverged="hadDivergence"
                  />

                  <ActionCluster
                    v-if="seSlot !== 'double-dummy'"
                    :can-undo="canUndo"
                    :show-claim="seSlot === 'cardplay' && !claimFormOpen"
                    :can-claim="!cardplay.botLoading.value && cardplay.remainingTricks.value !== 0"
                    :bot-status="cardplay.botLoading.value ? botName + ' thinking…' : (cardplayLineNote ? '↝ ' + cardplayLineNote : null)"
                    :bot-error="cardplay.botError.value || null"
                    @undo="undo"
                    @claim="openClaimForm"
                  />

                  <div v-if="claimFormOpen" class="bp-claim-form">
                    <div class="bp-claim-prompt">Claim how many of the {{ cardplay.remainingTricks.value }} remaining?</div>
                    <div class="bp-claim-buttons">
                      <button
                        v-for="n in claimOptions"
                        :key="n"
                        class="bp-claim-btn"
                        :disabled="claimValidating"
                        @click="confirmClaim(n)"
                      >{{ n }}</button>
                    </div>
                    <div v-if="claimValidating" class="bp-claim-validating">
                      {{ botName }} checking claim&hellip;
                    </div>
                    <div v-if="claimRejection" class="bp-claim-rejection">
                      <div class="bp-claim-rejection-msg">
                        <strong>{{ botName }} rejected the claim of {{ claimRejection.tricks }} trick{{ claimRejection.tricks === 1 ? '' : 's' }}.</strong>
                        <span v-if="claimRejection.message">{{ claimRejection.message }}</span>
                      </div>
                      <div class="bp-claim-rejection-actions">
                        <button class="bp-btn bp-claim-override" @click="overrideClaim">Override &amp; claim anyway</button>
                        <button class="bp-btn" @click="claimRejection = null">Try a different count</button>
                      </div>
                    </div>
                    <button v-if="!claimValidating" class="bp-btn bp-claim-cancel" @click="cancelClaim">Cancel</button>
                  </div>
                </div>
              </template>

            </BridgeTable>

            <div class="bp-right-rail">
              <!-- Auction + bidding box now live in the grid (centre/NE, and SE). The
                   rail keeps the cardplay controls + the off-turn bidding cue. -->
              <div v-if="auctionLoading && !auctionComplete" class="bp-card bp-waiting">
                Computing&hellip;
              </div>

              <!-- (The Cardplay panel that lived here was REMOVED 2026-07-29 — its
                   contents moved into the grid: tricks are already in the NW
                   StatusStrip, Claim + the claim form + bot thinking/errors went to
                   the SE action cluster, and Restart cardplay went to NW under
                   Restart deal once the play is complete.) -->

              <div v-if="cardplayPhase === 'unsupported'" class="bp-card bp-cardplay-notice">
                Cardplay is currently only supported when South is declarer.
                Defender and dummy modes will arrive in a future release.
              </div>

              <div v-if="auctionComplete && (cardplayPhase === 'off' || cardplayPhase === 'unsupported' || cardplayPhase === 'complete')" class="bp-contract">
                <div class="bp-contract-line">
                  Final contract:
                  <span v-if="finalContract.contract === 'Pass'">Passed out</span>
                  <span v-else>
                    <span v-html="formatContractHtml(finalContract.contract)"></span>
                    by {{ finalContract.declarer }}
                  </span>
                </div>
                <div class="bp-contract-meta">{{ shownSummary }}</div>

                <div v-if="cardplayPhase === 'complete' && cardplayResult" class="bp-cardplay-result">
                  You took <strong>{{ cardplayResult.took }}</strong> trick{{ cardplayResult.took === 1 ? '' : 's' }}
                  <span v-if="cardplayResult.needed != null">
                    · needed {{ cardplayResult.needed }} to make
                    <span :class="cardplayResult.made ? 'bp-made' : 'bp-down'">— {{ cardplayResult.made ? 'made' : 'down ' + (cardplayResult.needed - cardplayResult.took) }}</span>
                  </span>
                  <span v-if="cardplay.claim.value" class="bp-claim-tag">
                    (claimed at trick {{ cardplay.claim.value.atTrick }}<span v-if="cardplay.claim.value.overridden">, override</span>)
                  </span>
                </div>
                <div v-if="cardplayLineNote" class="bp-cardplay-line-note">↝ {{ cardplayLineNote }}</div>
                <div v-if="cardplayPhase === 'complete' && cardplay.botStats.value.count > 0" class="bp-cardplay-stats">
                  {{ botName }}: {{ cardplay.botStats.value.count }} calls ·
                  avg {{ fmtMs(cardplay.botStats.value.mean) }} ·
                  max {{ fmtMs(cardplay.botStats.value.max) }} ·
                  total {{ fmtMs(cardplay.botStats.value.total) }}
                </div>

                <!-- (Double dummy moved to the SE grid corner at review, 2026-07-29.) -->

                <!-- "Next deal" and "Replay this deal" were REMOVED here 2026-07-29:
                     NW now carries Next deal and Restart deal, and showing the same
                     two actions twice on one screen is worse than showing them once.
                     "Done" stays — it's the embedded widget's hand-back to Game
                     Analysis, has no NW equivalent, and is the only action that
                     surface needs. -->
                <div v-if="EMBEDDED" class="bp-contract-actions">
                  <button class="bp-btn bp-btn-primary" @click="done">Done</button>
                </div>
              </div>
            </div>
          </div>

          <!-- (The deal transport that used to sit here moved INTO the grid at
               2026-07-29: Restart/Next/Restart-cardplay → NW under the board glyph,
               Undo → the SE action cluster under the bidding box.) -->
        </template>
          </template>
        </TableShell>

        <div v-if="!EMBEDDED" class="bp-footer-row"><PageFooter /></div>
      </main>
    </div>

    <!-- Deal-source picker modal (mirrors the teacher console): the "Deal
         source…" button opens it; it self-sizes for all 8 tabs; a single-click
         (or multi + Deal) draws and closes it, freeing the screen for the table. -->
    <div v-if="showPicker && !EMBEDDED" class="bp-picker-backdrop" @click.self="showPicker = false">
      <div class="bp-picker-shell">
        <DealSourcePicker
          layout="compact"
          mode="stream"
          :allow="pickerAllow"
          :owner="ownerId"
          action-label="Deal"
          v-model="selection"
          @submit="onPickerSubmit"
          @close="showPicker = false"
        />
      </div>
    </div>

    <!-- Scenario description — the .btn @chat in the shared dockable/floating
         panel (same frame as the A1 lesson intro; honors the global dock pref). -->
    <DockablePanel
      :visible="showScenarioChat && !!scenarioChat"
      :title="scenarioChat?.title || 'Scenario'"
      :initial-width="620"
      :initial-height="520"
      @close="showScenarioChat = false"
      @geometry="chatGeometry = $event"
    >
      <ScenarioChatBody :text="scenarioChat?.text || ''" />
    </DockablePanel>

    <!-- Account / identity menu (Switch User, edit name, display/privacy) —
         switching or signing out returns to the main app to re-authenticate. -->
    <SettingsPanel
      :visible="showSettings"
      @close="showSettings = false"
      @switchUser="leaveToMainApp"
      @logout="leaveToMainApp"
      @become-teacher="leaveToMainApp"
    />

    <!-- Table settings: deal setup + cardplay display options, grouped. -->
    <div v-if="showTableSettings" class="modal-overlay" @click.self="showTableSettings = false">
      <div class="bp-settings-modal">
        <div class="bp-settings-head">
          <h3>Table settings</h3>
          <button class="bp-settings-x" @click="showTableSettings = false" title="Close">&times;</button>
        </div>
        <label class="bp-setting-row"><input type="checkbox" v-model="rotateDeals"> Rotate deals randomly</label>
        <label class="bp-setting-row"><input type="checkbox" v-model="playCardplay"> Play the hand after bidding</label>
        <label v-if="playCardplay" class="bp-setting-row" title="The bots always BID with BBA — this picks the CARDPLAY bot only.">
          <span>Play bot</span>
          <select class="bp-bot-select" v-model="cardplayBotName">
            <option v-for="o in botOptions" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</option>
          </select>
        </label>
        <div class="bp-setting-sep">Cardplay display</div>
        <label class="bp-setting-row"><input type="checkbox" v-model="cardplayShowPlayed"> Show played cards</label>
        <label class="bp-setting-row"><input type="checkbox" v-model="cardplayShowAll"> Show all hands</label>
        <label class="bp-setting-row"><input type="checkbox" v-model="cardplay.autoplayUserSingletons.value"> Auto-play singletons</label>
        <label class="bp-setting-row" title="After the hand, flag each played card with its double-dummy cost.">
          <input type="checkbox" v-model="cardplayShowDdErrors"> Show double-dummy cardplay errors
        </label>
        <div class="bp-setting-sep">Auction</div>
        <label class="bp-setting-row" title="Show the BBA expected-auction comparison in the bidding grid.">
          <input type="checkbox" v-model="showBbaCompare"> Show BBA auction comparison
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import SeatControlTable from '../components/table/SeatControlTable.vue'
import TableShell from '../components/table/TableShell.vue'
import KibitzBox from '../components/table/KibitzBox.vue'
import DealControls from '../components/table/DealControls.vue'
import DealSourceButton from '../components/table/DealSourceButton.vue'
import ScenarioBar from '../components/table/ScenarioBar.vue'
import RailCard from '../components/table/RailCard.vue'
import ActionCluster from '../components/table/ActionCluster.vue'
import { dealControlsReservePx, actionClusterReservePx, doubleDummyReservePx } from '../components/table/clusterMetrics.js'
import { biddingBoxReservePx } from '../components/biddingBoxMetrics.js'
import BiddingBox from '../components/BiddingBox.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import StatusStrip from '../components/StatusStrip.vue'
import BoardIndicator from '../components/BoardIndicator.vue'
import { A1_BOARD_SIZE, boardIndicatorExtentPx } from '../components/boardIndicatorMetrics.js'
import tableConfig from '../table-configs/table.tableConfig.js'
import DockablePanel from '../components/DockablePanel.vue'
import ScenarioChatBody from '../components/ScenarioChatBody.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import PageFooter from '../components/lobby/PageFooter.vue'
import DealSourcePicker from '../components/dealSource/DealSourcePicker.vue'
import DoubleDummyTable from '../components/DoubleDummyTable.vue'
import { formatBid, formatCardCode } from '../utils/cardFormatting.js'
import { getBot, listBots, makeCardplayFirstBot } from '../utils/cardplayBots.js'
import { warmBen } from '../utils/benClient.js'
import { fetchScenarioMeta } from '../utils/pbsScenarios.js'
import { useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { useTableHandoff } from '../composables/useTableHandoff.js'
import { useLocalEngine } from '../composables/engines/localEngine.js'
import { useTableSlots } from '../composables/engines/tableSlots.js'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { useServerEngine } from '../composables/engines/serverEngine.js'
import { useAppConfig } from '../composables/useAppConfig.js'
import { useCardPlayAnalysis } from '../composables/useCardPlayAnalysis.js'
import { trumpFromContract, computeRemaining } from '../utils/cardplayRules.js'
import { seatAtIndex } from '../utils/handAnalysis.js'
import DealSourceModal from '../components/table/DealSourceModal.vue'
import TableDiagnostics from '../components/table/TableDiagnostics.vue'

// The one table shell serves two modes. `server` (set by the table parents —
// TableHostView / TableLobbyView / TeacherConsoleView) selects the live
// table-service seat/kibitz view driven by ServerEngine; the default is the
// solo LocalEngine practice shell. Server-mode state lives in `srv` (reactive so
// the template auto-unwraps its refs, and namespaced so it can't collide with
// the solo bindings). See useServerTable.js.
const props = defineProps({ server: { type: Boolean, default: false } })
// 'exit' — leave a served table (server mode). 'host' — solo asks the parent to
// upgrade this /table to a served table in place (see inviteFriends).
const emit = defineEmits(['exit', 'host'])
const srv = props.server ? reactive(useServerEngine()) : null

// ── Config ────────────────────────────────────────────────────────────
// PBS deal/menu fetching lives in the resolver + pbsScenarios.js; the BBA and
// double-dummy calls live in bbaClient.js / ddsClient.js. This view only keeps
// the one policy value it owns.
const CONFIG = {
  // Default convention card for the embedded host AND for non-scenario deal
  // sources (Random / Paste / Library / Club), where there's no scenario name
  // to hand BBA — we still want a BBA "expected auction" to diff against.
  DEFAULT_CARD: '21GF-DEFAULT',
}

// ── Embedded-mode params ──────────────────────────────────────────────
// When the page is loaded with ?pbn=... we run as an iframe-friendly
// single-deal player: scenario menu/nav are hidden, the BBA call uses
// explicit conventions instead of a scenario name, and lifecycle events
// (ready, auction-complete, done, error) are postMessage'd to window.parent.
// The deal is left in its actual compass frame — N is N, the DD table
// matches the board — and we just show the student's specific hand panel.
function readEmbeddedParams() {
  if (typeof window === 'undefined') return null
  // Hash router: query may live before the hash (?pbn=...#/route) or
  // inside it (#/route?pbn=...). Merge both so the host can use either.
  let qs = (window.location.search || '').replace(/^\?/, '')
  const hash = window.location.hash || ''
  const hashQ = hash.indexOf('?')
  if (hashQ !== -1) qs = qs ? qs + '&' + hash.slice(hashQ + 1) : hash.slice(hashQ + 1)
  const sp = new URLSearchParams(qs)
  const pbn = sp.get('pbn')
  if (!pbn) return null
  const card = sp.get('card') || CONFIG.DEFAULT_CARD
  const seat = (sp.get('seat') || 'S').toUpperCase()
  return {
    pbn,
    dealer: sp.get('dealer'),
    vul: sp.get('vul'),
    seat: ['N', 'E', 'S', 'W'].includes(seat) ? seat : 'S',
    cards: {
      ns: sp.get('cardNS') || card,
      ew: sp.get('cardEW') || card,
    },
  }
}
const embeddedParams = readEmbeddedParams()
// Solo-only: server mode never runs the embedded (?pbn iframe) flow, even if the
// table URL carries ?pbn (the server view handles that itself).
const EMBEDDED = !props.server && !!embeddedParams
// The compass seat the human is sitting at. Defaults to S for the
// standalone scenario flow (which has always been South-centric).
const STUDENT_SEAT = EMBEDDED ? embeddedParams.seat : 'S'

function postEmbedded(msg) {
  if (typeof window === 'undefined') return
  try { window.parent.postMessage(msg, '*') } catch {}
}

// ── State ─────────────────────────────────────────────────────────────
// The picker lives in a modal (opened by the "Deal source…" button), so it has
// room for all 8 tabs — Club/Library included. `owner` (the logged-in user, if
// any) makes those tabs functional; anonymous users see a register note.
const userStore = useUserStore()
const { currentUser } = userStore

// Account avatar (top-right) — same identity menu as the main app / host table.
const showSettings = ref(false)
// Table settings popup (deal setup + cardplay display options).
const showTableSettings = ref(false)
const userInitials = computed(() => {
  const u = currentUser.value
  if (!u) return '?'
  return `${(u.firstName || '').charAt(0)}${(u.lastName || '').charAt(0)}`.toUpperCase() || '?'
})
const userName = computed(() => {
  const u = currentUser.value
  return u ? `${u.firstName} ${u.lastName}`.trim() : ''
})
const router = useRouter()
function leaveToMainApp() {
  showSettings.value = false
  router.push('/')
}
// Deep-links land here without going through the main app, so load the signed-in
// user from storage ourselves (idempotent) — needed for "Invite friends" and the
// picker's account-gated tabs (Club/Library).
userStore.initialize()
const ownerId = computed(() => currentUser.value?.id || null)

// "Invite friends" — the solo→served conversion (D9). Requires an account (the
// server session is owner-scoped).
const handoff = useTableHandoff()
// Invite → upgrade this same /table view to a served (server-engine) table IN
// PLACE (no navigation): stash the current deal source and ask the parent
// TableView to switch to server mode, which spins up the session and applies the
// handoff on connect. The mode swap only happens at a board boundary, so a live
// hand isn't interrupted.
function inviteFriends() {
  if (!ownerId.value) {
    window.alert('Sign in first to host a shared table and invite friends.')
    return
  }
  if (hasSelection.value) handoff.setPending(selection.value)
  emit('host')
}

const showPicker = ref(false)
const pickerAllow = {
  tabs: ['favorites', 'scenarios', 'curated', 'clubgames', 'library', 'pbn', 'random', 'history'],
  options: ['fresh'],
}

// The board-manager engine (P3, LocalEngine) is created below (after the prefs
// it reads). It owns the deal source (selection/draw/parse), the auction/board
// flow (currentDeal, bids, BBA expected auction, divergence, double-dummy) AND
// cardplay. This view keeps presentation, prefs, the picker, narrative, the
// claim/teaching-toggle UI, and the embedded shell.
const drawing = ref(false) // "dealing…" spinner between a draw and the load

// Scenario-chat popup: the .btn @chat for the open scenario, shown auto-on-open
// and reopenable from the scenario bar. { title, text } or null.
const scenarioChat = ref(null)
const showScenarioChat = ref(false)

// Docked-gutter reflow (mirrors MainLayout's lesson-intro): when the scenario
// description is docked (the global uiPrefs.introDock preference), reserve a left
// gutter the width of the panel so the table reflows to its right instead of
// hiding behind it; floating overlays with no reflow.
const appConfig = useAppConfig()
const chatGeometry = ref(null)
const introDocked = computed(() => appConfig.uiPrefs.value.introDock === 'dock')
const chatReserved = computed(() => introDocked.value && showScenarioChat.value && !!scenarioChat.value)
const chatGutter = computed(() => {
  if (!chatReserved.value) return null
  const g = chatGeometry.value
  if (!g) return '644px' // panel not yet reporting: reserve the default width
  return `${Math.round(g.x + g.w + 16)}px`
})
const chatCache = ref({})       // scenario file -> fetchScenarioMeta result
let lastChatScenario = ''       // avoids re-popping chat on same-scenario next-deals

// Persist the rotate-randomly preference across reloads.
const ROTATE_KEY = 'bp.rotateDeals'
const rotateDeals = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(ROTATE_KEY) === '1'
)
watch(rotateDeals, (v) => {
  try { localStorage.setItem(ROTATE_KEY, v ? '1' : '0') } catch {}
})

// Cardplay toggle — when on, after each auction completes we transition into
// trick-by-trick cardplay (currently South-declarer only).
const PLAY_KEY = 'bp.playCardplay'
const BOT_KEY = 'bp.cardplayBot'
const SHOW_PLAYED_KEY = 'bp.cardplayShowPlayed'
const SHOW_ALL_KEY = 'bp.cardplayShowAll'
const AUTOPLAY_SINGLETONS_KEY = 'bp.cardplayAutoplaySingletons'
const playCardplay = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(PLAY_KEY) === '1'
)
// Default to BEN now that it's tuned for latency (speed_TF2 config: ~5.6s
// opening lead, ~0.9s thereafter). `random` stays in the dropdown as a
// dev/offline fallback. Existing users keep whatever they've picked before.
const cardplayBotName = ref(
  (typeof localStorage !== 'undefined' && localStorage.getItem(BOT_KEY)) || 'ben'
)
// Teaching toggles — both default OFF.
//   showPlayed: keep played cards visible (strike-through) instead of removing them.
//     Useful for beginners learning trick mechanics. Also forced-true during 'complete'
//     so the user can review all original cards after the deal ends.
//   showAll: expose defender hands during cardplay. Useful for advanced study
//     (squeezes, endplays). At 'complete' all hands are revealed regardless.
const cardplayShowPlayed = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_PLAYED_KEY) === '1'
)
const cardplayShowAll = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_ALL_KEY) === '1'
)
watch(playCardplay, (v) => {
  try { localStorage.setItem(PLAY_KEY, v ? '1' : '0') } catch {}
  // Pre-warm BEN when the user opts into cardplay so the cold start happens
  // before the first real call. No-op if BEN isn't the active bot.
  if (v) maybeWarmBen()
})
watch(cardplayBotName, (v) => {
  try { localStorage.setItem(BOT_KEY, v) } catch {}
  if (v === 'ben') maybeWarmBen()
})
watch(cardplayShowPlayed, (v) => {
  try { localStorage.setItem(SHOW_PLAYED_KEY, v ? '1' : '0') } catch {}
})
watch(cardplayShowAll, (v) => {
  try { localStorage.setItem(SHOW_ALL_KEY, v ? '1' : '0') } catch {}
})

// Two review overlays, both default ON (opt-out via '0', unlike the teaching
// toggles above which are opt-in via '1'):
//   showDdErrors: flag each played card with its double-dummy cost after the hand
//     (see documentation/design/dd-cardplay-analysis-spec.md). State + persistence
//     live now; the overlay that reads this ref ships once solver-service /dd/play
//     exists (bridge-solver-service#4).
//   showBbaCompare: show the BBA "expected auction" comparison (divergedBids) in
//     the auction grid. Off → we pass an empty map so AuctionTable skips the
//     stacked user/BBA rows.
const SHOW_DD_ERRORS_KEY = 'bp.cardplayShowDdErrors'
const SHOW_BBA_COMPARE_KEY = 'bp.cardplayShowBbaCompare'
const cardplayShowDdErrors = ref(
  typeof localStorage === 'undefined' || localStorage.getItem(SHOW_DD_ERRORS_KEY) !== '0'
)
const showBbaCompare = ref(
  typeof localStorage === 'undefined' || localStorage.getItem(SHOW_BBA_COMPARE_KEY) !== '0'
)
watch(cardplayShowDdErrors, (v) => {
  try { localStorage.setItem(SHOW_DD_ERRORS_KEY, v ? '1' : '0') } catch {}
})
watch(showBbaCompare, (v) => {
  try { localStorage.setItem(SHOW_BBA_COMPARE_KEY, v ? '1' : '0') } catch {}
})

// ── The board-manager engine (LocalEngine) ─────────────────────────────
// Owns the deal source, the auction/board flow, AND cardplay (useCardPlay).
// The shell reads engine.yourSeat / engine.capabilities (seat-agnostic) and
// sources cardplay from engine.cardplay, so the same shell can later drive
// ServerEngine. The engine resets its own cardplay on new-board/restart.
const engine = useLocalEngine({
  yourSeat: STUDENT_SEAT,
  embedded: EMBEDDED,
  embeddedCards: embeddedParams?.cards || null,
  rotate: () => rotateDeals.value,
})
const {
  capabilities, yourSeat, cardplay,
  selection, hasSelection, sourceSummary: poolSummary,
  currentDeal, dealsDrawn, boardNumber: localBoardNumber, currentScenario, currentScenarioLabel, dealError, dealErrorHint,
  bids, expectedAuction, meanings, conventionsUsed, divergedBids, auctionLoading,
  finalContract, doubleDummy,
  auctionComplete, currentSeat, lastNonPassNonDouble, wrongIndicesArray, hadDivergence,
  phase: enginePhase,
  summary, canDouble, canRedouble,
  loadDeal, onUserBid, toggleDivergedBid, resetAuction,
  undo, canUndo,
} = engine
// Gate the BBA "expected auction" comparison on the user setting: when off, hand
// AuctionTable an empty map so it skips the stacked user/BBA rows entirely.
// EVERY BBA-comparison surface honours the one setting (2026-07-29 bug report:
// the rail said "1 of your bids differed from the BBA — see the divergent cells
// above" while the cells showed nothing, because only the stacked cells were gated).
// There are three surfaces and they must agree:
//   1. the stacked ●/○ cells   → shownDivergedBids
//   2. the RED diverged cell   → shownWrongIndices (drives AuctionTable's wrong-bid)
//   3. the rail sentence       → shownSummary
// With the comparison off the user has opted out of BBA feedback entirely, so all
// three go quiet rather than leaving a marker pointing at a hidden explanation.
// The scenario bar's sub-lines. Composed here, not inside the component: WHICH
// lines apply is a per-surface question (a served table has no local pool summary).
const scenarioMetaLines = computed(() => {
  if (!currentDeal.value) {
    return ['You sit South; three BBA bots fill the other seats.', 'Pick a deal source to start bidding.']
  }
  const out = []
  const cc = conventionsUsed.value
  if (cc) out.push(`CC · NS: ${cc.ns} · EW: ${cc.ew}`)
  if (poolSummary.value) out.push(`Source: ${poolSummary.value}`)
  return out
})

const shownDivergedBids = computed(() => showBbaCompare.value ? divergedBids.value : {})
const shownWrongIndices = computed(() => showBbaCompare.value ? wrongIndicesArray.value : [])
// `summary` is wholly a BBA statement — either "N of your bids differed…" or "You
// matched the BBA all the way through" — so it's suppressed as a unit, not edited.
const shownSummary = computed(() => showBbaCompare.value ? summary.value : '')
const availableBots = listBots()
// Display name for a cardplay-bot key. `random`/`ben`/`rules` are all wired in
// the frontend now — `rules` (RulesBot) runs in-browser via the bridge-rulebot
// wasm adapter (src/vendor/bridge-rulebot-wasm), the same core the table service
// uses server-side.
function botDisplayName(b) {
  return { ben: 'BEN', random: 'Random', rules: 'RulesBot' }[b] || b
}

// Solo seat identities: you sit `yourSeat`; the other three seats are the
// practice bots. They always BID with BBA; when you play the hand they also play
// with the selected cardplay bot — so "BBA" alone in bidding-only, else e.g.
// "BBA+BEN". Feeds BridgeTable `:occupants` so the seats are named (player + bot),
// mirroring the host table.
const soloBotSeatName = computed(() =>
  playCardplay.value ? `BBA+${botDisplayName(cardplayBotName.value)}` : 'BBA')
// Cardplay-bot dropdown options. All registered bots are selectable; the
// disabled "coming soon" row only appears if `rules` somehow isn't registered
// (e.g. the wasm failed to load), so the option never silently vanishes.
const botOptions = computed(() => {
  const opts = availableBots.map((b) => ({ value: b, label: botDisplayName(b), disabled: false }))
  if (!availableBots.includes('rules')) {
    opts.push({ value: 'rules', label: 'RulesBot — coming soon', disabled: true })
  }
  return opts
})
// The seat a cardplay bot is currently thinking on (pink frame) — mostly BEN on
// the first trick or two. Null when it's a human's turn (that seat goes blue).
const cardplayThinkingSeat = computed(() =>
  cardplay.botLoading.value ? cardplay.currentPlayer.value : null)

// Scenario/source name without a trailing "· Board N" — the board number is shown
// in the board-status glyph (NW), so it's not repeated in the ribbon.
const scenarioNameNoBoard = computed(() =>
  (currentScenarioLabel.value || '').replace(/\s*·\s*Board\b.*$/i, '').trim())

const soloOccupants = computed(() => {
  const u = currentUser.value
  const myName = u ? `${u.firstName} ${u.lastName}`.trim() : 'You'
  // Solo supports South-as-declarer only, so North is the dummy South plays — it's
  // NEVER a cardplay bot. So North toggles "BBA" (bidding) ↔ "Dummy" (play), with
  // no "+play-bot" suffix. E/W are bid by BBA and played by the cardplay bot.
  const inPlay = localCenterSlot.value === 'trick-area' || localCenterSlot.value === 'review'
  const out = {}
  for (const s of ['N', 'E', 'S', 'W']) {
    let name
    if (s === yourSeat.value) name = myName
    else if (s === 'N') name = inPlay ? 'Dummy' : 'BBA'
    else name = soloBotSeatName.value
    out[s] = { name }
  }
  return out
})

// Claim form: shown inline in the Cardplay status card when the user
// clicks "Claim…". The user picks how many of the remaining tricks they
// claim for the declaring side; defenders implicitly get the rest. If the
// active bot supports claim validation (BenBot does, RandomLegalBot
// doesn't) the engine asks the bot first; a rejection surfaces the bot's
// message and an Override button.
const claimFormOpen = ref(false)
const claimValidating = ref(false)
const claimRejection = ref(null)  // { tricks, message } when the bot rejected
const claimOptions = computed(() => {
  const r = cardplay.remainingTricks.value
  const out = []
  for (let i = 0; i <= r; i++) out.push(i)
  return out
})
function openClaimForm() {
  claimFormOpen.value = true
  claimRejection.value = null
}
function cancelClaim() {
  claimFormOpen.value = false
  claimRejection.value = null
  claimValidating.value = false
}
async function confirmClaim(declarerTricks) {
  claimValidating.value = true
  claimRejection.value = null
  try {
    const result = await cardplay.validateClaim(declarerTricks)
    if (result.accepted) {
      cardplay.claimTricks(declarerTricks)
      claimFormOpen.value = false
    } else {
      // Stash the rejection; user can override or cancel.
      claimRejection.value = { tricks: declarerTricks, message: result.message }
    }
  } finally {
    claimValidating.value = false
  }
}
function overrideClaim() {
  if (!claimRejection.value) return
  cardplay.claimTricks(claimRejection.value.tricks, {
    overridden: true,
    rejectionMessage: claimRejection.value.message,
  })
  claimRejection.value = null
  claimFormOpen.value = false
}

// Keep the engine's autoplay-singletons ref synced to a persisted user pref.
cardplay.autoplayUserSingletons.value = (
  typeof localStorage !== 'undefined' && localStorage.getItem(AUTOPLAY_SINGLETONS_KEY) === '1'
)
watch(cardplay.autoplayUserSingletons, (v) => {
  try { localStorage.setItem(AUTOPLAY_SINGLETONS_KEY, v ? '1' : '0') } catch {}
})

// Pre-warm BEN once per page load. Idempotent.
let _benWarmed = false
function maybeWarmBen() {
  if (_benWarmed) return
  if (props.server) return // solo cardplay only
  if (!playCardplay.value) return
  if (cardplayBotName.value !== 'ben') return
  _benWarmed = true
  warmBen()
}

// True when played cards should be hidden from the hand display
// (the default during live cardplay; always false at 'complete' so users
// can review the dealt hands).
const cardplayHidePlayed = computed(() => {
  if (cardplayPhase.value === 'complete') return false
  if (cardplayPhase.value !== 'playing') return false
  return !cardplayShowPlayed.value
})

// End-of-play reveal shows the deal FRESH — no strike-through (bug-artifacts#21).
// During live play, played cards may be struck (the "Show played cards" teaching
// toggle); at 'complete' we drop the `played` marks entirely so every hand reads
// like the original deal. The DD cardplay-error overlay (#24) will re-annotate
// only the error cards here via its own mark path, on top of this fresh reveal.
const revealPlayedCards = computed(() =>
  cardplayPhase.value === 'complete' ? null : cardplay.playedBySeat.value
)

// ── Post-hand double-dummy cardplay-error analysis (#24) ─────────────────
// Fires the batch DD trace when the hand completes (best-effort), gated on the
// "Show double-dummy cardplay errors" setting. Snapshot the deal + play trace
// here — `cardplay` is a singleton the next deal resets, and the trace/node
// calls must keep referring to THIS hand. F2 reads `errorsByCard` for badges;
// F3 calls `alternativesForNode` on tap.
const cardAnalysis = useCardPlayAnalysis()
// NB: the watch that fires the analysis lives below cardplayPhase's definition
// (it reads that computed eagerly, so it must be declared after it).

// Per-seat DD error badges for the fresh reveal (F2): only cards with cost > 0,
// grouped by the seat that played them. `−N` = tricks that play gave away; the
// fill deepens with cost. Only present at 'complete' with the setting on.
// Card code ("H4") → display text ("♥4"); formatCardCode returns {text, html}.
function cardLabel(code) { return formatCardCode(code).text }

// ── Post-hand DD review: recolor the MAIN table for one trick (#24, bug#21721) ─
// Reporter refinement: don't pop a second table. Clicking a card at the reveal
// rewinds the real table to that trick — hands show the position, the center
// TrickArea shows the cards led so far — and tints the acting seat's LEGAL cards
// green (double-dummy best) / pink (gave a trick away), ringing the card actually
// played. Click any card again to revert to the full fresh reveal.
const ddInspectEnabled = computed(() =>
  cardplayShowDdErrors.value && cardplayPhase.value === 'complete' && !!cardAnalysis.trace.value
)
const inspectedK = ref(null)      // play-index under review, or null (= full reveal)
const inspectedAlts = ref(null)   // node payload { seat, card, cost, alternatives }
const inspecting = computed(() => inspectedK.value !== null)

async function onCardInspect({ seat, suit, rank }) {
  // While reviewing, ANY card click returns to the full reveal.
  if (inspecting.value) { inspectedK.value = null; inspectedAlts.value = null; return }
  const k = cardplay.played.value.findIndex(p => p.seat === seat && p.suit === suit && p.rank === rank)
  if (k < 0) return
  inspectedK.value = k
  inspectedAlts.value = null
  const res = await cardAnalysis.alternativesForNode(k)
  if (inspectedK.value === k && res) inspectedAlts.value = res // ignore if superseded
}

// The trick containing the inspected play (played[] is 4-per-trick, chronological).
const inspectedTrickStart = computed(() =>
  inspectedK.value === null ? 0 : Math.floor(inspectedK.value / 4) * 4
)
const actingSeat = computed(() =>
  inspectedK.value === null ? null : cardplay.played.value[inspectedK.value]?.seat || null
)
// Banner context (which trick, who, what, cost) — replaces the old modal header.
const inspectInfo = computed(() => {
  if (!inspecting.value) return null
  const p = cardplay.played.value[inspectedK.value]
  return {
    trickNo: Math.floor(inspectedK.value / 4) + 1,
    seat: p?.seat || '',
    card: p ? p.suit + p.rank : '',
    cost: inspectedAlts.value?.cost ?? null,
  }
})

// TrickArea feed: while reviewing, synthesise the cards led to that trick BEFORE
// the acting seat (the position the player faced); otherwise the live trick.
const centerTrick = computed(() => {
  if (!inspecting.value) return cardplay.currentTrick
  const played = cardplay.played.value
  const start = inspectedTrickStart.value
  return { leader: played[start]?.seat || null, plays: played.slice(start, inspectedK.value) }
})
const centerLastTrick = computed(() =>
  inspecting.value ? null : cardplay.lastFinishedTrick.value
)
const centerNextSeat = computed(() =>
  inspecting.value ? actingSeat.value : cardplay.currentPlayer.value
)

// Flat [{suit,rank}] (computeRemaining output) → suit-keyed hand for the table.
function seatCardsToHand(flat) {
  const h = { spades: [], hearts: [], diamonds: [], clubs: [] }
  const key = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
  for (const c of flat || []) h[key[c.suit]].push(c.rank)
  return h
}

// Per-seat card marks fed to the table's cardBadges prop:
//  • plain reveal → the −N error badges (F2);
//  • overview   → each error card is badged with the TRICK NUMBER it went wrong
//    at (e.g. "error at trick 3"), red fill by severity.
//  • reviewing  → the acting seat's legal cards tinted green/pink, the played
//    card ringed (`chosen`), and each negative (pink) card badged with its COST.
const GOOD_FILL = 'rgba(46,160,67,0.34)'
const BAD_FILL = 'rgba(216,72,72,0.34)'
const ddCardBadges = computed(() => {
  if (!cardplayShowDdErrors.value || cardplayPhase.value !== 'complete') return null
  if (inspecting.value) {
    const node = inspectedAlts.value
    const seat = actingSeat.value
    if (!node || !seat) return null
    const cards = {}
    for (const a of node.alternatives) {
      cards[a.card] = a.cost > 0
        ? { fill: BAD_FILL, badge: '−' + a.cost } // cost on each negative card
        : { fill: GOOD_FILL }
    }
    if (node.card) cards[node.card] = { ...cards[node.card], chosen: true }
    return { N: {}, E: {}, S: {}, W: {}, [seat]: cards }
  }
  const t = cardAnalysis.trace.value?.trace
  if (!t) return null
  const out = { N: {}, E: {}, S: {}, W: {} }
  for (const e of t) {
    if (e.cost > 0 && out[e.seat]) {
      out[e.seat][e.card] = {
        badge: String(Math.floor(e.index / 4) + 1), // trick number the error occurred at
        fill: e.cost >= 2 ? 'rgba(198,40,40,0.40)' : 'rgba(216,72,72,0.28)',
      }
    }
  }
  return out
})

// ── Derived (view-side: presentation over the engine + cardplay + prefs) ─
const visibleHands = computed(() => {
  if (!currentDeal.value) return { N: null, E: null, S: null, W: null }
  // DD review: rewind every hand to the position BEFORE the inspected card, so the
  // acting seat still holds its options (incl. the played card) and the trick's
  // earlier cards show in the center TrickArea.
  if (inspecting.value) {
    const rem = computeRemaining(currentDeal.value.hands, cardplay.played.value.slice(0, inspectedK.value))
    const out = {}
    for (const s of ['N', 'E', 'S', 'W']) out[s] = seatCardsToHand(rem[s])
    return out
  }
  // During cardplay, defer to the engine for which seats are visible — but
  // the "Show all hands" teaching toggle overrides to reveal defenders too.
  if (cardplayPhase.value === 'playing') {
    if (cardplayShowAll.value) return currentDeal.value.hands
    const out = { N: null, E: null, S: null, W: null }
    for (const seat of ['N', 'E', 'S', 'W']) {
      if (!cardplay.hiddenSeats.value.includes(seat)) {
        out[seat] = currentDeal.value.hands[seat]
      }
    }
    return out
  }
  if (auctionComplete.value) return currentDeal.value.hands
  // During bidding, only the student's seat is visible.
  const visible = { N: null, E: null, S: null, W: null }
  visible[yourSeat.value] = currentDeal.value.hands[yourSeat.value]
  return visible
})
const hiddenSeats = computed(() => {
  if (!currentDeal.value) return []
  if (cardplayPhase.value === 'playing') {
    if (cardplayShowAll.value) return []
    return cardplay.hiddenSeats.value
  }
  if (auctionComplete.value) return []
  return ['N', 'E', 'S', 'W'].filter(s => s !== yourSeat.value)
})

// Cardplay phase — the solo shell's finer 5-state view, now layered over the
// engine's canonical 3-state `phase` (Slice 5). The coarse bidding/play/review
// authority lives in the engine (enginePhase); this computed only adds the
// review sub-states the solo UI still distinguishes, all of which depend on the
// view-level "Play the hand" toggle. Slice 6 collapses the template branches
// onto enginePhase directly.
//   bidding     — auction in progress            (enginePhase === 'bidding')
//   off         — auction done, toggle off (existing flow: reveal all 4 hands)
//   unsupported — toggle on but you aren't declarer (v1 limitation; reveal + notice)
//   playing     — actively playing tricks (incl. the pre-start transient)
//   complete    — 13 tricks done; show DD + result
// Provably identical to the pre-Slice-5 formula (the old `isActive ? playing :
// playing` tail is a single 'playing'); locked by the cross-product test in
// tableEngine.test.js.
const cardplayPossible = computed(() => {
  if (!auctionComplete.value) return false
  const fc = finalContract.value
  return fc && fc.contract && fc.contract !== 'Pass' && fc.declarer === yourSeat.value
})
const cardplayPhase = computed(() => {
  if (enginePhase.value === 'bidding') return 'bidding'
  if (!playCardplay.value) return 'off'
  if (!cardplayPossible.value) return 'unsupported'
  if (cardplay.playComplete.value) return 'complete'
  return 'playing'
})

// Fire the post-hand DD analysis on entering 'complete' (see cardAnalysis above).
// Declared here because the eager watch getter reads cardplayPhase immediately.
watch(() => cardplayPhase.value, (phase) => {
  if (phase !== 'complete') { cardAnalysis.reset(); inspectedK.value = null; inspectedAlts.value = null; return }
  if (!cardplayShowDdErrors.value) return
  const deal = currentDeal.value
  const fc = finalContract.value
  if (!deal || !fc?.contract || fc.contract === 'Pass' || !fc.declarer) return
  const plays = cardplay.played.value.map(p => p.suit + p.rank)
  if (!plays.length) return
  cardAnalysis.analyze({
    hands: deal.hands,
    trump: trumpFromContract(fc.contract) || 'NT',
    declarer: fc.declarer,
    leader: seatAtIndex(fc.declarer, 1), // opening leader = declarer's LHO
    plays,
  })
})

// ── Slice 6: mutually-exclusive table slots, decided in ONE place ──────────
// Both shells read the center (trick area) / action (bidding box) swap from the
// SAME derivation (useTableSlots) instead of re-testing phase inline. Local
// rides the localEngine phase/wantsCall lifted in Slice 5. `hasCardplay` = "is
// cardplay engaged for this board" — for local that's `playCardplay &&
// cardplayPossible` (NOT playComplete): the trick area owns the center for the
// whole post-auction life of a playable deck (matching the old
// cardplayPhase ∈ {playing, complete} gate, including the pre-first-card moment
// and toggled-off-mid-play), and never for off/unsupported. Locked by the
// cross-product test in tableEngine.test.js.
//
// Slice 6b adopted the "hidden off-turn" model for the server too: the server
// action slot now also rides `wantsCall` (= `myTurnToBid`), so the seated
// player's bidding box is HIDDEN when it isn't their turn (the "Waiting for …"
// line remains the affordance), matching local's on-turn-only box.
const { center: localCenterSlot, action: localActionSlot, status: localStatusSlot } = useTableSlots({
  phase: enginePhase,
  wantsCall: engine.wantsCall,
  hasCardplay: computed(() => playCardplay.value && cardplayPossible.value),
  // context (commentary/chat) has no docked home on the local practice path — its
  // chat is a popup — so the context slot lands with MainLayout/server, not here.
})

// What the SE (action) corner holds — bidding box, the cardplay action cluster, or
// the double-dummy table at review (2026-07-29 relocation). Null collapses the
// corner, which the arranger's occupancy model already handles.
const seSlot = computed(() => {
  if (!auctionComplete.value) return 'bidding'
  if (cardplayPhase.value === 'playing') return 'cardplay'
  if (capabilities.value?.doubleDummy && doubleDummy.value) return 'double-dummy'
  return null
})

// Corner reserves. The arranger derives a region's width from its ROLE, which can't
// know that NW now also holds the deal transport or that SE swaps a bidding box for
// a DD table — nor that a viewer without the transport should reserve nothing for
// it. So the shell, which placed the content, supplies the number.
const localRegionReserves = computed(() => {
  const nwTransport = dealControlsReservePx({
    showRestart: true,
    showNext: !EMBEDDED,
    showRestartCardplay: cardplayPhase.value === 'complete',
  })
  // NW stacks the glyph above the transport, so the column is the WIDER of the two.
  const nw = Math.max(Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE)), nwTransport)
  let se = 0
  if (seSlot.value === 'bidding') se = Math.max(biddingBoxReservePx(), actionClusterReservePx({ showUndo: true }))
  else if (seSlot.value === 'cardplay') se = actionClusterReservePx({ showUndo: true, showClaim: true })
  else if (seSlot.value === 'double-dummy') se = doubleDummyReservePx()
  return se > 0 ? { nw, se } : { nw }
})

// Phase-aware status (Phase 2, status region): one StatusStrip replaces the
// scattered dealer/vul chips and adds contract-relative tricks during play.
const { status: localStatus } = useTableStatus({
  phase: enginePhase,
  dealer: computed(() => currentDeal.value?.dealer),
  vulnerable: computed(() => currentDeal.value?.vulnerable),
  contract: computed(() => {
    const fc = finalContract.value
    return fc && fc.contract && fc.contract !== 'Pass'
      ? { text: fc.contract, declarer: fc.declarer }
      : null
  }),
  tricks: computed(() => cardplay.tricksTaken.value || { NS: 0, EW: 0 }),
})
const srvSlots = props.server
  ? useTableSlots({
      phase: computed(() => (srv.phase === 'complete' ? 'review' : srv.phase)),
      wantsCall: computed(() => !!srv.myTurnToBid),
      hasCardplay: computed(() => true), // a served board always plays out
    })
  : null
const srvCenterSlot = srvSlots ? srvSlots.center : null
const srvActionSlot = srvSlots ? srvSlots.action : null
const srvStatusSlot = srvSlots ? srvSlots.status : null

// SE (action corner) content on the served table — same three-state model as the
// solo path, so the two branches place the identical components in the identical
// corner. Bidding needs a seat; DD at review needs the capability.
const srvSeSlot = computed(() => {
  if (!srv) return null
  if (srv.yourSeat && srv.dealLoaded && srv.phase === 'bidding' && srv.boardMode !== 'play-only') return 'bidding'
  if (srvCenterSlot?.value === 'review' && srv.capabilities?.doubleDummy && srv.doubleDummy) return 'double-dummy'
  return null
})

// Corner reserves, server path. The owner/guest asymmetry is the whole reason this
// prop exists: `canDeal`/`canManageSeats` are false for an invited player, so B3
// reserves nothing in NW for a transport it never renders.
const srvRegionReserves = computed(() => {
  if (!srv) return null
  const nwTransport = dealControlsReservePx({
    showRestart: false,
    showNext: !!(srv.canDeal || srv.canHostAdvance),
    showRestartCardplay: false,
  })
  const nw = Math.max(Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE)), nwTransport)
  const undo = srv.canManageSeats ? actionClusterReservePx({ showUndo: true }) : 0
  let se = 0
  if (srvSeSlot.value === 'bidding') se = Math.max(biddingBoxReservePx(), undo)
  else if (srvSeSlot.value === 'double-dummy') se = doubleDummyReservePx()
  return se > 0 ? { nw, se } : { nw }
})

// Phase-aware status for the server header (Phase 2 status region, server path).
// srv is a reactive() unwrap, so wrap its fields as computeds for useTableStatus.
const srvStatus = srv
  ? useTableStatus({
      phase: computed(() => (srv.phase === 'complete' ? 'review' : srv.phase)),
      dealer: computed(() => srv.dealer),
      vulnerable: computed(() => srv.vulnerable),
      contract: computed(() => srv.contract || null),
      tricks: computed(() => srv.tricksTaken || { NS: 0, EW: 0 }),
    }).status
  : null
const botName = computed(() => {
  try { return getBot(cardplayBotName.value).name } catch { return cardplayBotName.value }
})

// Result-vs-DD comparison (shown post-cardplay).
const cardplayResult = computed(() => {
  if (!cardplay.playComplete.value) return null
  const fc = finalContract.value
  if (!fc?.contract || fc.contract === 'Pass') return null
  // Tricks declarer's side took.
  const declarerSide = (fc.declarer === 'N' || fc.declarer === 'S') ? 'NS' : 'EW'
  const took = cardplay.tricksTaken.value[declarerSide]
  const m = fc.contract.match(/^(\d)/)
  const needed = m ? parseInt(m[1], 10) + 6 : null
  return { took, needed, made: needed != null && took >= needed }
})


// ── Helpers ───────────────────────────────────────────────────────────

function formatContractHtml(contract) {
  return formatBid(contract).html || contract
}

// Format a latency in ms as either "ms" or "Xs" / "X.Ys" depending on magnitude.
function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 1000).toFixed(0)}s`
}

// Display name for a scenario file (used for the chat popup title).
function prettifyLabel(file) {
  return file.replace(/_/g, ' ').trim()
}

// ── Lifecycle ─────────────────────────────────────────────────────────
onMounted(async () => {
  // If cardplay is already enabled with BEN selected, warm the model now
  // so the user's first opening lead doesn't eat the cold start.
  maybeWarmBen()

  if (EMBEDDED) {
    postEmbedded({ type: 'bridge-classroom:ready' })
    await loadEmbeddedDeal()
    return
  }
  // Non-embedded: the picker (in the sidebar) drives selection; the first board
  // is drawn when the student picks a source. Nothing to preload here.
})

async function loadEmbeddedDeal() {
  try {
    const deal = engine.parseDeal(embeddedParams.pbn, {
      dealer: embeddedParams.dealer || 'N',
      vulnerable: embeddedParams.vul || 'None',
    })
    if (!deal) throw new Error('Invalid PBN deal string (expected "N:hand hand hand hand")')
    // Embedded uses explicit conventions (embeddedCards), not a scenario name,
    // so scenario stays '' (the engine's generateAuction branches on embedded).
    await loadDeal(deal, { scenario: '', label: 'Replay' })
  } catch (err) {
    dealError.value = 'Could not load embedded deal: ' + err.message
  }
}

function done() {
  postEmbedded({ type: 'bridge-classroom:done' })
}

watch(() => auctionComplete.value, (isComplete) => {
  if (!EMBEDDED || !isComplete) return
  postEmbedded({
    type: 'bridge-classroom:auction-complete',
    auction: bids.value.slice(),
    contract: finalContract.value.contract,
    declarer: finalContract.value.declarer,
    dealer: currentDeal.value.dealer,
    studentSeat: yourSeat.value,
    meanings: meanings.value.slice(),
  })
})

// Off-the-recorded-line indicator for a deal source that shipped a [Play] line
// (declarer-play coaching boards). `null` until the play diverges from the line;
// set once by the composite bot below. Reset on every fresh startPlay.
const cardplayLineDivergence = ref(null)
// User-facing note when play has gone off the recorded line. A seat plays one
// card per trick, so its play-index + 1 is the trick number it diverged at.
const cardplayLineNote = computed(() => {
  const d = cardplayLineDivergence.value
  if (!d) return null
  return `Off the recorded line from trick ${d.index + 1} — bots now play with ${botName.value}.`
})

// Build the cardplay bot for a startPlay. When the deal source carries a
// recorded [Play] line, wrap the selected engine in the CARDPLAY-FIRST composite
// (follow the line; on divergence/absence delegate to the real bot) so the
// coached defense stays coherent after the human departs from the model line.
// A deal with no line is a pure pass-through — the selected bot from move one.
function buildCardplayBot() {
  cardplayLineDivergence.value = null
  let base
  try { base = getBot(cardplayBotName.value) } catch { base = getBot('random') }
  const line = currentDeal.value?.playLine
  const hasLine = line?.bySeat && ['N', 'E', 'S', 'W'].some(s => line.bySeat[s]?.length)
  if (!hasLine) return base
  return makeCardplayFirstBot(line.bySeat, base, {
    onDivergence: (d) => { cardplayLineDivergence.value = d },
  })
}

// v1: South declares → user controls S (own hand) + N (dummy). Defenders are
// bots. Wider scopes (defender / N-declares) are deferred per plan.
function dummyFor(declarer) {
  return declarer === 'N' ? 'S' : declarer === 'S' ? 'N' : declarer === 'E' ? 'W' : 'E'
}

// Enter cardplay when the auction completes if the toggle is on and the
// contract is South-declared. The engine then drives bots to the first user
// turn (or to completion if no user seat is active).
watch(() => auctionComplete.value, async (isComplete) => {
  if (!isComplete || EMBEDDED) return
  if (!playCardplay.value) return
  if (!cardplayPossible.value) return
  const fc = finalContract.value
  await engine.startPlay({
    hands: currentDeal.value.hands,
    dealer: currentDeal.value.dealer,
    vulnerable: currentDeal.value.vulnerable,
    bids: bids.value.slice(),
    contract: fc.contract,
    declarer: fc.declarer,
    bot: buildCardplayBot(),
    userSeats: [fc.declarer, dummyFor(fc.declarer)],
  })
})

watch(dealError, (msg) => {
  if (EMBEDDED && msg) postEmbedded({ type: 'bridge-classroom:error', message: msg })
})

// Show the scenario's @chat popup (fetch the .btn metadata if not cached yet).
async function showChatForScenario(file) {
  let meta = chatCache.value[file]
  if (!meta) {
    meta = await fetchScenarioMeta(file)
    chatCache.value = { ...chatCache.value, [file]: meta }
  }
  if (meta?.description) {
    scenarioChat.value = { title: prettifyLabel(file), text: meta.description }
    showScenarioChat.value = true
  } else {
    scenarioChat.value = null
    showScenarioChat.value = false
  }
}

// The picker emits a selection (single-click fires immediately; multi fires on
// "Deal"). Stick it as the sticky source, close the modal, and draw the board.
async function onPickerSubmit(sel) {
  engine.loadSource(sel)
  showPicker.value = false
  await drawNextBoard()
}

// Draw ONE board from the current selection via the engine (which owns the
// source + draw + PBN parse), then load it into the auction/cardplay flow. Used
// by the picker submit AND the "Next deal →" button.
async function drawNextBoard() {
  if (!hasSelection.value) return
  dealError.value = ''
  dealErrorHint.value = ''
  drawing.value = true
  let drawn
  try {
    drawn = await engine.nextBoard()
  } catch (err) {
    dealError.value = 'Could not draw a deal: ' + err.message
    drawing.value = false
    return
  }
  if (!drawn.ok) {
    dealError.value = 'The drawn board could not be loaded.'
    drawing.value = false
    return
  }
  await loadDeal(drawn.deal, { scenario: drawn.scenarioFile, label: drawn.label })
  drawing.value = false
  // Auto-show the scenario chat when a NEW scenario opens (not on same-scenario
  // next-deals, non-scenario sources, or embedded single-deal mode).
  if (drawn.scenarioFile && drawn.scenarioFile !== lastChatScenario && !EMBEDDED) {
    lastChatScenario = drawn.scenarioFile
    showChatForScenario(drawn.scenarioFile)
  } else if (!drawn.scenarioFile) {
    lastChatScenario = ''
    scenarioChat.value = null
  }
}

// "Next deal" — draw the next board from the current selection (a fresh board
// from the same pool; scenario/curated/random draw randomly, others sequential).
async function newDeal() {
  await drawNextBoard()
}

// Cardplay click handler — routes user clicks on S or N (dummy) into the
// cardplay engine. Mirrors the suit-letter / rank-letter shape that
// HandDisplay emits.
async function onCardClick({ seat, suit, rank }) {
  // Unified engine action — LocalEngine routes to cardplay.onUserCard (seat is
  // implied by whose turn it is); ServerEngine.play sends the card to the server.
  const result = await engine.play(seat, suit, rank)
  if (!result.ok && result.reason) {
    // HandDisplay's clickable-cards UI doesn't yet filter to legal cards, so
    // users can click illegal cards and the engine rejects them silently.
    // TODO: pass legalCardsForCurrent down to HandDisplay for proper greyout.
    if (typeof console !== 'undefined') console.warn('Cardplay click rejected:', result.reason)
  }
}

async function restartCardplay() {
  cardplay.reset()
  // Re-enter cardplay using the same logic as the auction-complete watcher.
  const fc = finalContract.value
  if (!fc || !cardplayPossible.value) return
  await engine.startPlay({
    hands: currentDeal.value.hands,
    dealer: currentDeal.value.dealer,
    vulnerable: currentDeal.value.vulnerable,
    bids: bids.value.slice(),
    contract: fc.contract,
    declarer: fc.declarer,
    bot: buildCardplayBot(),
    userSeats: [fc.declarer, dummyFor(fc.declarer)],
  })
}

</script>

<style scoped>
.bp-app {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: #f7f7f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #222;
}
/* While the scenario description is docked at the left edge, reserve a left
   gutter the width of the panel so the practice content reflows to its right
   instead of hiding behind it (mirrors MainLayout's `.app.intro-open`). Only on
   screens wide enough to hold the gutter plus the content — narrower screens keep
   the layout and the panel floats over it. */
@media (min-width: 1200px) {
  .bp-app.intro-open .bp-main {
    padding-left: var(--intro-gutter, 644px);
  }
}

.bp-app.embedded {
  grid-template-rows: 1fr;
}
.bp-app.embedded .bp-main {
  grid-template-columns: minmax(0, 1fr);
}
.bp-app.embedded .bp-stage {
  padding: 10px 14px;
  gap: 10px;
  align-items: stretch;
}
.bp-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 24px;
  border-bottom: 0.5px solid #ddd;
  background: #fff;
  gap: 12px;
}
.bp-logo { font-size: 15px; font-weight: 500; color: #222; text-decoration: none; }
.bp-logo .suit { color: #1D9E75; margin-right: 6px; }
/* Account circle — matches the main app / host table avatar. */
.user-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--green-mid, #667eea) 0%, var(--green-dark, #764ba2) 100%);
  color: #fff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
}
.user-btn:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18); }
/* Footer pinned to the bottom of the (flex-column) stage; stretch so the shared
   PageFooter spans the width instead of shrinking to its content. */
.bp-footer-row { align-self: stretch; margin-top: auto; }

/* The deal source now lives in a modal (opened by the "Deal source…" button),
   so the main area is a single full-width stage — max room for the table. */
.bp-main {
  min-height: 0;
  position: relative;
}
.bp-stage {
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* Children are now the full-width TableShell (which centres its own content at
     1400) + the footer, so stretch rather than centre. Matches the embedded
     override below. */
  align-items: stretch;
  gap: 18px;
}

/* Deal-source picker modal (mirrors the teacher console's tc-modal-*). The
   compact picker self-sizes (min(560px,94vw)); the backdrop just centers it. */
.bp-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4vh 16px;
  box-sizing: border-box;
  z-index: 60;
}
.bp-picker-shell {
  display: flex;
  flex-direction: column;
}

@media (max-width: 1100px) {
  .bp-stage { padding: 14px; gap: 12px; }
}


.bp-bot-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #444;
}

.bp-cardplay-card .bp-cardplay-status {
  font-size: 13px;
  color: #444;
  margin-bottom: 8px;
}
.bp-cardplay-card .bp-cardplay-thinking {
  font-size: 11px;
  color: #1D9E75;
  font-style: italic;
  margin-bottom: 8px;
}
.bp-cardplay-stats {
  font-size: 11px;
  color: #666;
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
}
.bp-cardplay-error {
  font-size: 11px;
  color: #b00;
  background: #fee;
  border: 0.5px solid #fbb;
  border-radius: 4px;
  padding: 4px 6px;
  margin-bottom: 8px;
}
.bp-cardplay-line-note {
  font-size: 11px;
  color: #8a6d00;
  background: #fdf6e3;
  border: 0.5px solid #eadfae;
  border-radius: 4px;
  padding: 4px 6px;
  margin-bottom: 8px;
}
.bp-cardplay-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.bp-claim-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: #f0fdf6;
  border: 0.5px solid #c8e8d6;
  border-radius: 6px;
}
.bp-claim-prompt {
  font-size: 12px;
  color: #444;
}
.bp-claim-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.bp-claim-btn {
  min-width: 30px;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid #1D9E75;
  background: #fff;
  color: #1D9E75;
  border-radius: 4px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.bp-claim-btn:hover { background: #1D9E75; color: #fff; }
.bp-claim-cancel { align-self: flex-start; font-size: 11px; padding: 3px 8px; }
.bp-claim-tag {
  font-size: 12px;
  color: #1D9E75;
  font-style: italic;
  margin-left: 4px;
}
.bp-claim-validating {
  font-size: 11px;
  color: #1D9E75;
  font-style: italic;
}
.bp-claim-rejection {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #fee;
  border: 0.5px solid #fbb;
  border-radius: 4px;
}
.bp-claim-rejection-msg {
  font-size: 12px;
  color: #6e1f1f;
  line-height: 1.4;
}
.bp-claim-rejection-msg strong { display: block; margin-bottom: 4px; }
.bp-claim-rejection-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bp-claim-override {
  color: #fff;
  background: #b00;
  border-color: #b00;
}
.bp-claim-override:hover { background: #900; border-color: #900; }
.bp-cardplay-notice {
  background: #fff8e6;
  border: 0.5px solid #ead38d;
  color: #6e520f;
  font-size: 12px;
  line-height: 1.5;
}
.bp-cardplay-result {
  font-size: 14px;
  color: #444;
  margin-top: 4px;
}
.bp-cardplay-result .bp-made { color: #1D9E75; font-weight: 600; }
.bp-cardplay-result .bp-down { color: #d32f2f; font-weight: 600; }

/* Stage states */
/* (The priming spotlight moved into DealSourceButton.vue as .dsb-attn, pulse
   and reduced-motion guard included.) */

/* No-deal empty table (identity-only BridgeTable). Match the live table width. */
.bp-empty-table { width: 100%; max-width: 1400px; margin: 0 auto; }
.bp-error-box {
  color: #b00;
  font-size: 13px;
  padding: 14px 16px;
  background: #fee;
  border: 1px solid #fbb;
  border-radius: 6px;
  max-width: 560px;
  line-height: 1.5;
}
.bp-error-hint { margin-top: 6px; font-size: 12px; }

/* Scenario header */
.bp-scenario-bar {
  width: 100%;
  /* Column: action buttons on top (they wrap), then the board-source info
     full-width below on ~2 lines — instead of the info squeezed into a narrow,
     deeply-wrapped column beside a non-wrapping button row. */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 8px;
}
/* Board source / meta — flows horizontally and wraps, full width, under the buttons. */
.bp-scenario-name { font-size: 15px; font-weight: 500; }
.bp-scenario-meta { font-size: 12px; color: #666; }
.bp-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.bp-btn:hover { border-color: #888; }

/* "Table settings" button pushed to the right end of the top action row. */
.bp-actions-spacer { flex: 1 1 auto; }
.bp-settings-btn { margin-left: auto; }

/* Table-settings popup (deal setup + cardplay display options). */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  z-index: 2000;
  padding: 20px;
}
.bp-settings-modal {
  background: #fff;
  border-radius: var(--radius-card, 10px);
  max-width: 360px;
  width: 100%;
  margin: auto;
  max-height: 90dvh;
  overflow-y: auto;
  padding: 18px 20px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bp-settings-head { display: flex; align-items: center; justify-content: space-between; }
.bp-settings-head h3 { margin: 0; font-size: 16px; }
.bp-settings-x { background: none; border: none; font-size: 24px; line-height: 1; color: #999; cursor: pointer; padding: 0; }
.bp-settings-x:hover { color: #333; }
.bp-setting-row { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.bp-setting-row > span { margin-right: auto; }
.bp-setting-sep {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid #eee;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #999;
}

/* DD review banner: context for the recoloured trick on the table below (#24). */
.bp-review-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  margin: 0 auto 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--surface-2, #f3f4f6);
  border: 1px solid var(--border, #e3e5e8);
  font-size: 13px;
  color: var(--text, #333);
}
.bp-review-good { color: #2e7d32; font-weight: 600; }
.bp-review-bad { color: #c62828; font-weight: 600; }
.bp-review-hint { color: #999; font-style: italic; }

/* Deal-control buttons (VCR-style) — a centred row below the table. */
/* Button styling now lives in DealControls.vue (scoped). Only the row's PLACEMENT
   in this shell stays here — which is exactly the part that goes away when the row
   moves into the NW grid region. */
.bp-deal-controls { margin-top: 12px; }
.bp-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.bp-btn:disabled:hover { border-color: #ccc; }
.bp-btn-primary { background: #1D9E75; color: #fff; border-color: #1D9E75; }
.bp-btn-primary:hover { background: #167a5a; border-color: #167a5a; }

/* Main table layout */
.bp-table-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  align-items: start;
  width: 100%;
  /* Cardplay needs ~240px for the center trick area; with two 220-min
     hand columns + 320px right rail + 24px gap, the table has room.
     1100 → 1400 to match the server/host table (.tv-page) width so the solo
     and multi-user views look the same to the user. */
  max-width: 1400px;
}
@media (max-width: 1100px) {
  .bp-table-wrap { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}

.bp-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
}
.bp-loading { color: #1D9E75; font-size: 11px; }

.bp-right-rail { display: flex; flex-direction: column; gap: 14px; }
.bp-card {
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 12px;
}
.bp-card h3 {
  font-size: 11px;
  color: #666;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

/* Contract / DD */
.bp-contract {
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.bp-contract-line { font-size: 18px; font-weight: 500; }
.bp-contract-meta { font-size: 13px; color: #666; }
.bp-contract-actions { display: flex; gap: 8px; margin-top: 10px; }

/* formatBid() emits <span class="red|black">…</span> for the final contract;
   :deep() pierces scoped styles to colour those spans. */
.bp-contract :deep(.red) { color: #d32f2f; }
.bp-contract :deep(.black) { color: #1a1a1a; }

/* ══ Server-mode (table-service) styles — folded from the old TableView ══ */
/* .tv-page / .tv-header / .tv-main / .tv-table-wrap / .tv-rail moved to the
   shared TableShell.vue (ts-*). Content-primitive tv-* classes below stay here —
   they style slot content, which compiles in this component's scope. */
.tv-closed-card {
  max-width: 420px;
  margin: 80px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  text-align: center;
}
.tv-closed-card h2 { margin: 0 0 8px; }
.tv-btn {
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tv-btn:hover:not(:disabled) { border-color: #007bff; }
.tv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tv-btn-active { background: #fff3cd; border-color: #e0b34d; color: #7a5b00; font-weight: 600; }
.tv-btn-primary { background: #1d9e75; border-color: #1d9e75; color: #fff; }
.tv-btn-primary:hover:not(:disabled) { background: #178a65; border-color: #178a65; }
.tv-title { font-size: 20px; font-weight: 700; margin-right: 4px; }
.tv-tag { background: #f0f0f0; border-radius: 12px; padding: 3px 10px; font-size: 13px; color: #444; }
.tv-tag-bots { background: #ede7f6; color: #4527a0; }
.tv-tag-toggle {
  background: #e3f2ec; color: #1d6e50; border: 1px solid #bcd9cc;
  cursor: pointer; font: inherit; font-size: inherit;
}
.tv-tag-toggle:hover { background: #d2e9de; }
.tv-conn { font-size: 13px; color: #666; }
.tv-conn-connected { color: #1d9e75; }
.tv-conn-reconnecting, .tv-conn-connecting, .tv-conn-minting { color: #e6a700; }
.tv-conn-error, .tv-conn-unavailable { color: #c62828; }
.tv-kibitz-note { color: #b26a00; font-size: 14px; margin: 0 0 8px; }
.tv-paused-note {
  color: #8a5a00; background: #fff6e5; border: 1px solid #f0d9a8;
  border-radius: 8px; padding: 8px 12px; font-size: 14px; font-weight: 600; margin: 0 0 8px;
}
.tv-passbot-hint { color: #777; font-size: 12px; margin-bottom: 6px; }
.tv-passbot-row { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 3px 0; cursor: pointer; }
/* NW grid region: BoardIndicator glyph + StatusStrip stacked (mirrors a1's #nw). */
.tv-grid-nw { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
/* SE action corner: the box (or DD table) with the action cluster stacked beneath.
   Both branches use the same stack so the two tables place the cluster identically. */
.tv-se-stack, .bp-se-stack { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.tv-center-wait { text-align: center; }
.tv-center-title { font-weight: 700; color: #24435a; font-size: 14px; }
.tv-center-sub { font-size: 11.5px; color: #8a97a3; margin-top: 3px; max-width: 180px; }
.tv-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
.tv-card h3 { margin: 0 0 8px; font-size: 15px; color: #333; }
.tv-waiting { color: #666; font-style: italic; }
.tv-bid-waiting { text-align: center; margin-top: 8px; }
.tv-center { text-align: center; color: #555; font-size: 14px; }
.tv-center-line { margin: 2px 0; }
.tv-center-muted { color: #8a8f94; font-size: 12px; }
.tv-status-line { font-size: 14px; color: #444; margin: 4px 0; }
.tv-your-turn { color: #1d9e75; font-weight: 600; }
.tv-bot-note { color: #999; font-size: 12px; }
.tv-result-line { font-weight: 600; }
.tv-ready-btn { margin-top: 8px; width: 100%; }
.tv-ready-line { color: #1d9e75; }
.tv-ready-wait { color: #888; font-style: italic; }
.tv-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: #333; color: #fff; padding: 10px 18px; border-radius: 8px;
  font-size: 14px; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25); z-index: 100;
}
.tv-toast-error { background: #c62828; }
.tv-fade-enter-active, .tv-fade-leave-active { transition: opacity 0.25s; }
.tv-fade-enter-from, .tv-fade-leave-to { opacity: 0; }
</style>
