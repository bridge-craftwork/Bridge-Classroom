<template>
  <!-- Welcome Screen (shown when no authenticated user) -->
  <WelcomeScreen
    v-if="!isAuthenticated"
    @userReady="handleUserReady"
  />

  <!-- Main App (shown when user is authenticated) -->
  <div v-else class="app" :class="{ 'intro-open': introReserved }" :style="{ '--intro-gutter': introGutter }" @click.capture="dismissWelcome">
    <!-- View-as banner — shown when admin is rendering the app as another user -->
    <div v-if="isViewingAs" class="view-as-banner">
      <span class="view-as-text">
        Viewing as <strong>{{ viewedUserName }}</strong> — read-only preview
      </span>
      <button class="stop-viewing-btn" @click="handleStopViewing">Stop viewing</button>
    </div>
    <header class="app-header" :class="{ 'has-greeting': showWelcome && !deals.length }">
      <h1><a href="/" style="color:inherit;text-decoration:none">{{ deals.length ? dealTitle : appTitle }}</a></h1>
      <!-- Greeting only on the lobby — on a lesson the long title + many header
           buttons leave no room for a centered greeting. -->
      <span v-if="showWelcome && !deals.length" class="welcome-greeting">Welcome back, {{ firstName }}</span>
      <div class="header-right">
        <SyncStatus />
        <!-- Progress + Accomplishments are practice/A1-specific — only in a lesson,
             not on the lobby (which is the hub for every app). The lobby keeps just
             the centered greeting + profile avatar, matching the other apps' bar. -->
        <button v-if="deals.length" class="progress-btn" @click="showProgress = true" title="View Progress">
          Progress
        </button>
        <button v-if="deals.length" class="accomplishments-btn" @click="showAccomplishments = true" title="View Accomplishments">
          Accomplishments
        </button>
        <button v-if="deals.length && currentCollection" class="lessons-btn" @click="returnToLessons" :title="'Back to ' + getCollection(currentCollection)?.name">
          {{ getCollection(currentCollection)?.name }}
        </button>
        <button v-if="currentCollection || deals.length" class="lobby-btn" @click="returnToLobby" title="Return to lobby">
          Lobby
        </button>
        <div class="stats" v-if="totalCorrect + totalWrong > 0">
          <span class="correct">{{ totalCorrect }}</span>
          <span class="wrong">{{ totalWrong }}</span>
        </div>
        <!-- User avatar -->
        <div class="user-avatar-group">
          <button
            class="user-btn"
            :class="{ 'user-btn-beta': overrideActive }"
            @click="showSettings = true"
            :title="overrideActive ? userName + ' · Beta preview (' + arrangement + ')' : userName"
          >
            {{ userInitials }}
          </button>
        </div>
      </div>
    </header>

    <main class="app-main">
      <!-- Announcement Banner (site-wide, admin-controlled) -->
      <AnnouncementBanner />
      <!-- Assignment Banner -->
      <AssignmentBanner />
      <!-- Lobby when no deals and no collection selected -->
      <LobbyView
        v-if="!deals.length && !currentCollection"
        @select-collection="selectCollection"
        @select-assignment="handleSelectAssignment"
        @resume-lesson="handleResumeLesson"
        @show-progress="showProgress = true"
        @show-become-teacher="showBecomeTeacher = true"
        @load-file="onFileSelect"
        @navigate-to-lesson="handleTeacherNavigateToLesson"
      />

      <!-- Collection selected but no lesson loaded yet - show lesson browser inline -->
      <div v-else-if="!deals.length && currentCollection" class="collection-view">
        <h2>{{ getCollection(currentCollection)?.name || currentCollection }}</h2>
        <p class="collection-subtitle">Select a lesson to begin practicing:</p>
        <LessonBrowser
          :visible="true"
          :inline="true"
          :collection="getCollection(currentCollection)"
          @load="handleLessonLoad"
        />
      </div>

      <!-- Practice interface -->
      <template v-else>
        <!-- Legacy compass layout — now the ESCAPE HATCH, not the default (A1 cut
             over to grid in production, slice 1.6b). Reached only via
             `?arrangement=legacy`; renders exactly as it did pre-flip (inner markup
             byte-identical). Retired entirely in slice 1.7. -->
        <!-- Two-column layout for desktop -->
        <!-- Keyed on 'legacy' explicitly, NOT "not grid": the axis gained a 'beta'
             channel (2026-07-30) and `!== 'grid'` would have dropped beta into the
             legacy branch. -->
        <div v-if="arrangement === 'legacy'" class="practice-layout">
          <!-- Left column: Deal info + Bridge table -->
          <div class="practice-left">
            <BoardMasteryStrip
              v-if="deals.length > 1"
              :boardNumbers="deals.map(d => d.displayNumber)"
              :lessonSubfolder="currentDeal?.subfolder || currentDeal?.category || ''"
              :collectionId="currentDeal?.collectionId || null"
              :currentIndex="currentDealIndex"
              :forceBoardStatus="forceBoardStatus"
              :exerciseContext="exerciseContext"
              :localPrerelease="prereleaseByBoard"
              :introUrl="introUrl"
              @goto="gotoDeal"
              @open-intro="handleOpenIntro"
            />

            <DealInfo
              :boardNumber="currentDeal?.displayNumber"
              :dealer="practice.displayDealer.value"
              :vulnerable="currentDeal?.vulnerable"
              :contract="currentDeal?.contract"
              :declarer="practice.displayDeclarer.value"
              :showContract="isDeclarerPlay || practice.auctionState.auctionComplete || practice.showOpeningLead.value || (practice.hasSteps.value && !practice.hasBidSteps.value)"
              :openingLead="practice.showOpeningLead.value ? currentDeal?.openingLead : ''"
              :totalDeals="deals.length"
              :currentIndex="currentDealIndex"
              :dealBoardNumbers="deals.map(d => d.boardNumber)"
              :bridgeContext="currentDeal?.bridgeContext || ''"
              :result="currentDeal?.result"
              :showResult="practice.auctionState.auctionComplete && currentCollection === 'pbs-coaching'"
              @goto="gotoDeal"
            />

            <BridgeTable
              v-if="!isDeclarerPlay"
              :hands="practice.hands.value"
              :hiddenSeats="practice.hiddenSeats.value"
              :showHcp="practice.showHcp.value"
              :compact="true"
              :clickableSeat="practice.hasCardChoice.value ? practice.studentSeat.value : null"
              :playedCards="practice.struckCards.value"
              :currentCards="practice.showcardsPlayedCards.value"
              @card-click="onCardClick"
            />
            <!-- Declarer-play lessons: live card table driven by the cardplay engine -->
            <BridgeTable
              v-else
              :hands="currentDeal.hands"
              :hiddenSeats="cardplay.hiddenSeats.value"
              :showHcp="true"
              :compact="true"
              :clickableSeat="cardplay.clickableSeat.value"
              :playedCards="cardplay.playedBySeat.value"
              :hidePlayedCards="true"
              @card-click="onDeclarerCard"
            >
              <template #center>
                <TrickArea
                  :current-trick="cardplay.currentTrick"
                  :last-finished-trick="cardplay.lastFinishedTrick.value"
                  :tricks-taken="cardplay.tricksTaken.value"
                  :next-seat="cardplay.currentPlayer.value"
                  :bot-loading="cardplay.botLoading.value"
                  bot-name="Defense"
                />
              </template>
            </BridgeTable>
          </div>

          <!-- Right column: Tag-driven content -->
          <div class="practice-right">
            <!-- Auction table - shown if deal has auction and [AUCTION off] not triggered -->
            <AuctionTable
              v-if="practice.showAuctionTable.value"
              :bids="practice.hasBidSteps.value ? practice.auctionState.displayedBids : (currentDeal?.auction || [])"
              :dealer="practice.displayAuctionDealer.value"
              :currentBidIndex="practice.hasBidSteps.value ? practice.auctionState.currentBidIndex : -1"
              :wrongBidIndex="practice.auctionState.wrongBidIndex"
              :correctBidIndex="practice.auctionState.correctBidIndex"
              :showTurnIndicator="practice.hasBidPrompt.value"
            />

            <!-- Feedback panel - shown after wrong bid (between auction and narrative) -->
            <FeedbackPanel
              :visible="!!practice.auctionState.wrongBid"
              type="wrong"
              :wrongBid="practice.auctionState.wrongBid"
              :correctBid="practice.auctionState.correctBid"
              :showContinue="false"
            />

            <!-- Accepted-alternative panel (orange) - the student chose a defensible
                 call that isn't the recorded one ([ACCEPT]). -->
            <FeedbackPanel
              :visible="!!practice.auctionState.altBid"
              type="alternative"
              :wrongBid="practice.auctionState.altBid"
              :correctBid="practice.auctionState.altRecordedBid"
              :showContinue="false"
            />

            <!-- Card choice feedback panel - shown after wrong card selection -->
            <FeedbackPanel
              :visible="!!practice.cardChoiceState.wrongCard"
              type="wrong"
              :wrongCardCode="practice.cardChoiceState.wrongCard"
              :correctCardCode="practice.cardChoiceState.correctCard"
              :showContinue="false"
            />

            <!-- Unified commentary panel - shown when deal has interactive steps -->
            <div v-if="practice.hasSteps.value" class="commentary-panel">
              <div class="commentary-text-container" ref="commentaryContainer">
                <!-- Previous steps (greyed out, except last step's explanation which is current context) -->
                <template v-for="(step, idx) in practice.steps.value.slice(0, practice.currentStepIndex.value)" :key="'prev-' + idx">
                  <template v-if="idx >= practice.commentaryStartIndex.value">
                    <span class="narrative-text previous" v-html="colorizeSuits(flowText(step.text))"></span>
                    <!-- Reframe note (#67): an accepted-alternative step's prose describes the recorded call, not the student's. -->
                    <span v-if="step.type === 'bid' && wasStepAlternative(idx) && step.explanationText"
                      class="narrative-text previous reframe-note"
                      v-html="reframeNoteHtml(step)"></span>
                    <span v-if="step.type === 'bid' && step.explanationText && (wasStepWrong(idx) || wasStepAlternative(idx) || step.fadeFollow == null)"
                      :class="['narrative-text', idx === practice.currentStepIndex.value - 1 && practice.isBidStep.value && !practice.bidAnswered.value ? 'current' : 'previous']"
                      v-html="colorizeSuits(flowText(step.explanationText))"></span>
                    <span v-else-if="step.type === 'bid' && !wasStepWrong(idx) && !wasStepAlternative(idx)"
                      class="narrative-text previous affirmation"
                      v-html="bidLabel(step.bid) + ' — ' + affirmationFor(idx)"></span>
                    <span v-if="step.type === 'bid' && !wasStepWrong(idx) && !wasStepAlternative(idx) && step.fadeFollow"
                      class="narrative-text previous"
                      v-html="colorizeSuits(flowText(step.fadeFollow))"></span>
                  </template>
                </template>
                <!-- Current step text (black) -->
                <span v-if="practice.currentStep.value" class="narrative-text current" v-html="colorizeSuits(flowText(practice.currentStep.value.text))"></span>
                <!-- Reframe note (#67) for the current step when it was an accepted alternative. -->
                <span v-if="practice.bidAnswered.value && practice.auctionState.altBid && practice.currentStep.value?.type === 'bid' && practice.currentStep.value?.explanationText" class="narrative-text current reframe-note" v-html="reframeNoteHtml(practice.currentStep.value)"></span>
                <!-- After a bid: full explanation when wrong (the teaching); brief affirmation when correct. -->
                <span v-if="practice.bidAnswered.value && practice.currentStep.value?.type === 'bid' && practice.currentStep.value?.explanationText && (practice.auctionState.wrongBid || practice.auctionState.altBid || practice.currentStep.value?.fadeFollow == null)" class="narrative-text current" v-html="colorizeSuits(flowText(practice.currentStep.value.explanationText))"></span>
                <span v-else-if="practice.bidAnswered.value && !practice.auctionState.wrongBid && !practice.auctionState.altBid && practice.currentStep.value?.type === 'bid'" class="narrative-text current affirmation" v-html="bidLabel(practice.currentStep.value.bid) + ' — ' + affirmationFor(practice.currentStepIndex.value)"></span>
                <span v-if="practice.bidAnswered.value && !practice.auctionState.wrongBid && !practice.auctionState.altBid && practice.currentStep.value?.fadeFollow" class="narrative-text current" v-html="colorizeSuits(flowText(practice.currentStep.value.fadeFollow))"></span>
                <!-- Board-level cheer when the whole auction was bid correctly. -->
                <span v-if="boardCelebration" class="narrative-text current celebration">{{ boardCelebration }}</span>
              </div>

              <!-- Controls based on current step type -->
              <div class="commentary-controls">
                <div class="controls-main">
                  <!-- Bidding box for bid steps -->
                  <div v-if="practice.hasBidPrompt.value" class="bidding-box-wrapper">
                    <BiddingBox
                      :lastBid="practice.lastContractBid.value"
                      :canDouble="practice.canDouble.value"
                      :canRedouble="practice.canRedouble.value"
                      @bid="onBid"
                    />
                  </div>
                  <!-- Card choice prompt -->
                  <div v-else-if="practice.hasCardChoice.value" class="card-choice-prompt">
                    Click on the card you would choose
                  </div>
                  <!-- Back button (left of Next) -->
                  <button
                    v-if="practice.canGoBack.value"
                    class="instruction-btn secondary"
                    @click="onStepBack"
                  >
                    ← Back
                  </button>
                  <!-- Next/Rotate button for non-bid, non-card-choice steps (including bid explanation dismissal) -->
                  <button
                    v-if="!practice.isComplete.value && (practice.bidAnswered.value || (!practice.hasBidPrompt.value && !practice.hasCardChoice.value && practice.currentStep.value && practice.currentStep.value.type !== 'end'))"
                    class="instruction-btn primary"
                    @click="practice.advance()"
                  >
                    {{ isRotateStep(practice.currentStep.value) ? 'Rotate' : 'Next' }} →
                  </button>
                  <!-- Next Deal button when complete -->
                  <button v-if="practice.isComplete.value && currentDealIndex < deals.length - 1" class="next-deal-btn" @click="nextDeal">
                    Next Deal →
                  </button>
                </div>
                <!-- Report a Problem — kept beside the bidding controls so long
                     coaching text can't push it off-screen. Opt-in per collection. -->
                <button v-if="reportEnabled" class="report-problem-btn" @click="openReport" title="Report a problem with this board">
                  ⚑ Report a Problem
                </button>
              </div>
            </div>

            <!-- Declarer-play lessons: coaching tip + tricks result + next -->
            <div v-if="isDeclarerPlay" class="declarer-play-panel">
              <div
                class="display-commentary"
                v-html="colorizeSuits(flowText(stripControlDirectives(declarerCoachingText)))"
              ></div>
              <div v-if="cardplay.playComplete.value" class="declarer-play-result">
                You took {{ cardplay.tricksTaken.value[declarerSide] }}
                trick{{ cardplay.tricksTaken.value[declarerSide] === 1 ? '' : 's' }}<span
                  v-if="tricksNeeded"> — needed {{ tricksNeeded }} for {{ currentDeal.contract }}</span>.
              </div>
              <div v-if="cardplay.playComplete.value && currentDealIndex < deals.length - 1" class="completion-controls">
                <button class="next-deal-btn" @click="nextDeal">Next Deal →</button>
              </div>
            </div>

            <!-- Display-only commentary (no interactive steps) -->
            <div v-if="!practice.hasSteps.value && !isDeclarerPlay && currentDeal?.commentary" class="display-commentary" v-html="colorizeSuits(flowText(stripControlDirectives(currentDeal.commentary)))">
            </div>
            <!-- Display-only completion: Next Deal button -->
            <div v-if="!practice.hasSteps.value && !isDeclarerPlay && practice.isComplete.value && currentDealIndex < deals.length - 1" class="completion-controls">
              <button class="next-deal-btn" @click="nextDeal">
                Next Deal →
              </button>
            </div>

            <!-- Report a Problem fallback for display-only boards (no controls row) -->
            <div v-if="!practice.hasSteps.value && reportEnabled" class="report-problem-row">
              <button class="report-problem-btn" @click="openReport" title="Report a problem with this board">
                ⚑ Report a Problem
              </button>
            </div>

          </div>
        </div>

        <!-- Grid arrangement (a1 grid-flip 1.6a — opt-in via ?arrangement=grid, dark by
             default). The hero hand + auction + bidding box + status compose in the
             named-area grid arranger (the signed-off gallery composition); the coaching
             commentary + feedback + Next/Back controls ride the shell companion. Reuses
             the SAME handlers/helpers/scoped styles as the legacy path above. -->
        <div v-else class="practice-grid-layout">
          <div class="practice-grid-stage">
            <BoardMasteryStrip
              v-if="deals.length > 1"
              :boardNumbers="deals.map(d => d.displayNumber)"
              :lessonSubfolder="currentDeal?.subfolder || currentDeal?.category || ''"
              :collectionId="currentDeal?.collectionId || null"
              :currentIndex="currentDealIndex"
              :forceBoardStatus="forceBoardStatus"
              :exerciseContext="exerciseContext"
              :localPrerelease="prereleaseByBoard"
              :introUrl="introUrl"
              @goto="gotoDeal"
              @open-intro="handleOpenIntro"
            />
            <BridgeTable
              arrangement="grid"
              :table-config="a1Config"
              :phase="gridPhase"
              :hands="isDeclarerPlay ? currentDeal.hands : practice.hands.value"
              :hidden-seats="gridHiddenSeats"
              :show-hcp="isDeclarerPlay ? true : (defenceScene ? false : practice.showHcp.value)"
              :clickable-seat="isDeclarerPlay ? cardplay.clickableSeat.value : (practice.hasCardChoice.value ? practice.studentSeat.value : null)"
              :played-cards="isDeclarerPlay ? cardplay.playedBySeat.value : practice.struckCards.value"
              :current-cards="isDeclarerPlay ? null : practice.showcardsPlayedCards.value"
              :hide-played-cards="isDeclarerPlay"
              :hero-seat="gridHeroSeat"
              :hero-name="firstName"
              :declarer="isDeclarerPlay ? currentDeal?.declarer : practice.displayDeclarer.value"
              @card-click="onGridCardClick"
            >
              <!-- NW: compact board·dealer·vul glyph (+ contract/result in play/review).
                   Sized to the arranger's status reserve — the full DealInfo overflowed
                   this column and occluded the auction (2026-07-12 bug report). -->
              <template #nw>
                <div class="a1-grid-nw">
                  <BoardIndicator
                    :board-number="currentDeal?.displayNumber || 1"
                    :dealer="practice.displayDealer.value || null"
                    :vulnerable="currentDeal?.vulnerable || null"
                    :size="A1_BOARD_SIZE"
                  />
                  <!-- The BoardIndicator glyph above already carries vul, so don't repeat
                       it in the strip; drop the trick chip in a defence choose-card scene
                       (tricks never advance) so only the contract shows. -->
                  <StatusStrip v-if="gridPhase !== 'bidding'" :status="gridStatus" :show-vul="false" :show-tricks="!defenceScene" :show-result="isDeclarerPlay" />
                </div>
              </template>
              <!-- CENTER: the trick (declarer play) or the live auction (bidding). -->
              <template #center>
                <TrickArea
                  v-if="isDeclarerPlay"
                  :current-trick="cardplay.currentTrick"
                  :last-finished-trick="cardplay.lastFinishedTrick.value"
                  :tricks-taken="cardplay.tricksTaken.value"
                  :next-seat="cardplay.currentPlayer.value"
                  :bot-loading="cardplay.botLoading.value"
                  bot-name="Defense"
                />
                <!-- Defensive-signals cardplay: the played cards ([showcards]) shown as a
                     centre trick, so E/S aren't scattered as tiny floored seats. -->
                <TrickArea
                  v-else-if="hasCentreTrick"
                  :current-trick="gridTrick"
                  :last-finished-trick="null"
                  :tricks-taken="currentDeal?.tricksTaken || { NS: 0, EW: 0 }"
                  :show-counter="false"
                  :next-seat="null"
                  bot-name="Defense"
                />
                <div v-else-if="practice.showAuctionTable.value && !companionAuction" class="a1-center-auction">
                  <AuctionTable
                    :bids="practice.hasBidSteps.value ? practice.auctionState.displayedBids : (currentDeal?.auction || [])"
                    :dealer="practice.displayAuctionDealer.value"
                    :currentBidIndex="practice.hasBidSteps.value ? practice.auctionState.currentBidIndex : -1"
                    :wrongBidIndex="practice.auctionState.wrongBidIndex"
                    :correctBidIndex="practice.auctionState.correctBidIndex"
                    :showTurnIndicator="practice.hasBidPrompt.value"
                  />
                </div>
              </template>
              <!-- NE: the completed auction pinned during declarer play. -->
              <template v-if="pinnedAuction" #ne>
                <div class="a1-grid-ne">
                  <AuctionTable :bids="currentDeal?.auction || []" :dealer="practice.displayAuctionDealer.value" :currentBidIndex="-1" />
                </div>
              </template>
              <!-- SE (hero's corner): the bidding box, clustered with the hand. -->
              <template v-if="!isDeclarerPlay && practice.hasBidPrompt.value" #se>
                <BiddingBox
                  :lastBid="practice.lastContractBid.value"
                  :canDouble="practice.canDouble.value"
                  :canRedouble="practice.canRedouble.value"
                  @bid="onBid"
                />
              </template>
            </BridgeTable>
          </div>

          <!-- Companion: lesson context ribbon + coaching commentary / feedback /
               Next-Back controls. The auction and bidding box now live in the grid. -->
          <div class="practice-grid-companion">
            <!-- Defence scenes: the completed auction rides atop the companion (above the
                 narrative), matching prod, instead of pinned tiny at NE. -->
            <div v-if="companionAuction" class="a1-companion-auction">
              <AuctionTable :bids="currentDeal?.auction || []" :dealer="practice.displayAuctionDealer.value" :currentBidIndex="-1" />
            </div>
            <!-- Blue context ribbon (the bridgeContext note that lived in DealInfo before
                 #nw went compact) — reunited with the coaching prose it belongs beside. -->
            <div v-if="currentDeal?.bridgeContext" class="grid-context-ribbon">
              <span class="grid-context-ribbon-icon" aria-hidden="true">ⓘ</span>
              <span>{{ currentDeal.bridgeContext }}</span>
            </div>
            <FeedbackPanel :visible="!!practice.auctionState.wrongBid" type="wrong" :wrongBid="practice.auctionState.wrongBid" :correctBid="practice.auctionState.correctBid" :showContinue="false" />
            <FeedbackPanel :visible="!!practice.auctionState.altBid" type="alternative" :wrongBid="practice.auctionState.altBid" :correctBid="practice.auctionState.altRecordedBid" :showContinue="false" />
            <FeedbackPanel :visible="!!practice.cardChoiceState.wrongCard" type="wrong" :wrongCardCode="practice.cardChoiceState.wrongCard" :correctCardCode="practice.cardChoiceState.correctCard" :showContinue="false" />

            <div v-if="practice.hasSteps.value" class="commentary-panel">
              <div class="commentary-text-container" ref="commentaryContainer">
                <template v-for="(step, idx) in practice.steps.value.slice(0, practice.currentStepIndex.value)" :key="'gprev-' + idx">
                  <template v-if="idx >= practice.commentaryStartIndex.value">
                    <span class="narrative-text previous" v-html="colorizeSuits(flowText(step.text))"></span>
                    <span v-if="step.type === 'bid' && wasStepAlternative(idx) && step.explanationText"
                      class="narrative-text previous reframe-note"
                      v-html="reframeNoteHtml(step)"></span>
                    <span v-if="step.type === 'bid' && step.explanationText && (wasStepWrong(idx) || wasStepAlternative(idx) || step.fadeFollow == null)"
                      :class="['narrative-text', idx === practice.currentStepIndex.value - 1 && practice.isBidStep.value && !practice.bidAnswered.value ? 'current' : 'previous']"
                      v-html="colorizeSuits(flowText(step.explanationText))"></span>
                    <span v-else-if="step.type === 'bid' && !wasStepWrong(idx) && !wasStepAlternative(idx)"
                      class="narrative-text previous affirmation"
                      v-html="bidLabel(step.bid) + ' — ' + affirmationFor(idx)"></span>
                    <span v-if="step.type === 'bid' && !wasStepWrong(idx) && !wasStepAlternative(idx) && step.fadeFollow"
                      class="narrative-text previous"
                      v-html="colorizeSuits(flowText(step.fadeFollow))"></span>
                  </template>
                </template>
                <span v-if="practice.currentStep.value" class="narrative-text current" v-html="colorizeSuits(flowText(practice.currentStep.value.text))"></span>
                <span v-if="practice.bidAnswered.value && practice.auctionState.altBid && practice.currentStep.value?.type === 'bid' && practice.currentStep.value?.explanationText" class="narrative-text current reframe-note" v-html="reframeNoteHtml(practice.currentStep.value)"></span>
                <span v-if="practice.bidAnswered.value && practice.currentStep.value?.type === 'bid' && practice.currentStep.value?.explanationText && (practice.auctionState.wrongBid || practice.auctionState.altBid || practice.currentStep.value?.fadeFollow == null)" class="narrative-text current" v-html="colorizeSuits(flowText(practice.currentStep.value.explanationText))"></span>
                <span v-else-if="practice.bidAnswered.value && !practice.auctionState.wrongBid && !practice.auctionState.altBid && practice.currentStep.value?.type === 'bid'" class="narrative-text current affirmation" v-html="bidLabel(practice.currentStep.value.bid) + ' — ' + affirmationFor(practice.currentStepIndex.value)"></span>
                <span v-if="practice.bidAnswered.value && !practice.auctionState.wrongBid && !practice.auctionState.altBid && practice.currentStep.value?.fadeFollow" class="narrative-text current" v-html="colorizeSuits(flowText(practice.currentStep.value.fadeFollow))"></span>
                <span v-if="boardCelebration" class="narrative-text current celebration">{{ boardCelebration }}</span>
              </div>

              <div class="commentary-controls">
                <div class="controls-main">
                  <div v-if="practice.hasCardChoice.value" class="card-choice-prompt">Click on the card you would choose</div>
                  <button v-if="practice.canGoBack.value" class="instruction-btn secondary" @click="onStepBack">← Back</button>
                  <button
                    v-if="!practice.isComplete.value && (practice.bidAnswered.value || (!practice.hasBidPrompt.value && !practice.hasCardChoice.value && practice.currentStep.value && practice.currentStep.value.type !== 'end'))"
                    class="instruction-btn primary" @click="practice.advance()">
                    {{ isRotateStep(practice.currentStep.value) ? 'Rotate' : 'Next' }} →
                  </button>
                  <button v-if="practice.isComplete.value && currentDealIndex < deals.length - 1" class="next-deal-btn" @click="nextDeal">Next Deal →</button>
                </div>
                <button v-if="reportEnabled" class="report-problem-btn" @click="openReport" title="Report a problem with this board">⚑ Report a Problem</button>
              </div>
            </div>

            <div v-if="isDeclarerPlay" class="declarer-play-panel">
              <div class="display-commentary" v-html="colorizeSuits(flowText(stripControlDirectives(declarerCoachingText)))"></div>
              <div v-if="cardplay.playComplete.value" class="declarer-play-result">
                You took {{ cardplay.tricksTaken.value[declarerSide] }}
                trick{{ cardplay.tricksTaken.value[declarerSide] === 1 ? '' : 's' }}<span v-if="tricksNeeded"> — needed {{ tricksNeeded }} for {{ currentDeal.contract }}</span>.
              </div>
              <div v-if="cardplay.playComplete.value && currentDealIndex < deals.length - 1" class="completion-controls">
                <button class="next-deal-btn" @click="nextDeal">Next Deal →</button>
              </div>
            </div>

            <div v-if="!practice.hasSteps.value && !isDeclarerPlay && currentDeal?.commentary" class="display-commentary" v-html="colorizeSuits(flowText(stripControlDirectives(currentDeal.commentary)))"></div>
            <div v-if="!practice.hasSteps.value && !isDeclarerPlay && practice.isComplete.value && currentDealIndex < deals.length - 1" class="completion-controls">
              <button class="next-deal-btn" @click="nextDeal">Next Deal →</button>
            </div>
            <div v-if="!practice.hasSteps.value && reportEnabled" class="report-problem-row">
              <button class="report-problem-btn" @click="openReport" title="Report a problem with this board">⚑ Report a Problem</button>
            </div>
          </div>
        </div>
      </template>
    </main>

    <!-- Settings Panel -->
    <SettingsPanel
      :visible="showSettings"
      @close="showSettings = false"
      @switchUser="handleSwitchUser"
      @logout="handleSwitchUser"
      @become-teacher="showBecomeTeacher = true"
    />

    <!-- Registration toast (brief confirmation after new user creation) -->
    <div v-if="showRegistrationToast" class="registration-toast">
      Account created — your data is encrypted and linked to your email for recovery.
    </div>

    <!-- Wild-mastery celebration: a Fresh paw earned on a Wild board -->
    <div v-if="activePaw" class="paw-toast" @click="activePaw = null">
      <PawIcon tier="Fresh" class="paw-toast-icon" />
      <span class="paw-toast-text">
        <strong>Wild board mastered!</strong>
        You earned a fresh paw{{ pawLessonName ? ` in ${pawLessonName}` : '' }}{{ activePaw.dealNumber != null ? ` #${activePaw.dealNumber}` : '' }} — clean on a wild board.
      </span>
    </div>

    <!-- Progress Dashboard Modal -->
    <div v-if="showProgress" class="modal-overlay" @click.self="showProgress = false">
      <ProgressDashboard @close="showProgress = false" />
    </div>

    <!-- Accomplishments Modal -->
    <div v-if="showAccomplishments" class="modal-overlay" @click.self="showAccomplishments = false">
      <AccomplishmentsView @close="showAccomplishments = false" @navigate-to-deal="handleNavigateToDeal" />
    </div>

    <!-- Floating Intro PDF Viewer (non-modal) -->
    <IntroPdfViewer
      :visible="showIntroPdf"
      :url="introPdfUrl || ''"
      @close="showIntroPdf = false"
      @geometry="introGeometry = $event"
    />

    <!-- Become a Teacher Modal -->
    <BecomeTeacherModal
      v-if="showBecomeTeacher"
      @close="showBecomeTeacher = false"
      @activated="handleTeacherActivated"
    />

    <!-- Report a Problem popup (draggable, opens below the button) -->
    <ReportProblemModal
      :visible="showReport"
      :context="reportContext"
      :anchor="reportAnchor"
      @close="showReport = false"
    />

    <!-- Page Footer -->
    <PageFooter />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { parsePbn, getDealTitle, isRotateStep } from '../utils/pbnParser.js'
import { stripControlDirectives, colorizeSuits, flowText, formatBid } from '../utils/cardFormatting.js'
import { useDealPractice } from '../composables/useDealPractice.js'
import { useCardPlay } from '../composables/useCardPlay.js'
import { makeReplayBot } from '../utils/cardplayBots.js'
import { useAppConfig } from '../composables/useAppConfig.js'
import { useUserStore } from '../composables/useUserStore.js'
import { useAssignmentStore } from '../composables/useAssignmentStore.js'
import { useDataSync } from '../composables/useDataSync.js'
import { useAccomplishments } from '../composables/useAccomplishments.js'
import { useStudentProgress } from '../composables/useStudentProgress.js'
import { useObservationStore } from '../composables/useObservationStore.js'
import { useBoardMastery } from '../composables/useBoardMastery.js'
import { useTeacherRole } from '../composables/useTeacherRole.js'
import { useAnnouncement } from '../composables/useAnnouncement.js'
import { useAssignments } from '../composables/useAssignments.js'
import { useBoardStatus } from '../composables/useBoardStatus.js'
import { usePawCelebration } from '../composables/usePawCelebration.js'
import PawIcon from '../components/PawIcon.vue'

import BridgeTable from '../components/BridgeTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import AuctionTable from '../components/AuctionTable.vue'
import DealInfo from '../components/DealInfo.vue'
import { useArrangement } from '../composables/useArrangement.js'
import { DEFAULT_ARRANGEMENT } from '../utils/arrangement.js'
import a1Config from '../table-configs/a1.tableConfig.js'
import BoardIndicator from '../components/BoardIndicator.vue'
import StatusStrip from '../components/StatusStrip.vue'
import { A1_BOARD_SIZE } from '../components/boardIndicatorMetrics.js'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { buildTrickFromShowcards, playedCardOnlySeats } from '../utils/defenseTrick.js'
import { captureA1Snapshot, a1SnapshotToEnrich } from '../report/captureA1Snapshot.js'
import { setReportContextProvider, clearReportContextProvider } from '../report/reportContext.js'
import { resolveTableConfig } from '../report/tableConfigSnapshot.js'
import DealNavigator from '../components/DealNavigator.vue'
import FeedbackPanel from '../components/FeedbackPanel.vue'
import WelcomeScreen from '../components/WelcomeScreen.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import AssignmentBanner from '../components/AssignmentBanner.vue'
import AnnouncementBanner from '../components/AnnouncementBanner.vue'
import SyncStatus from '../components/SyncStatus.vue'
import ProgressDashboard from '../components/ProgressDashboard.vue'
import AccomplishmentsView from '../components/AccomplishmentsView.vue'
import LessonBrowser from '../components/LessonBrowser.vue'
import BoardMasteryStrip from '../components/BoardMasteryStrip.vue'
import IntroPdfViewer from '../components/IntroPdfViewer.vue'
import LobbyView from './LobbyView.vue'
import BecomeTeacherModal from '../components/BecomeTeacherModal.vue'
import ReportProblemModal from '../components/ReportProblemModal.vue'
import PageFooter from '../components/lobby/PageFooter.vue'

// Router
const router = useRouter()

// Composables
const appConfig = useAppConfig()
const userStore = useUserStore()
const assignmentStore = useAssignmentStore()
const dataSync = useDataSync()
const teacherRole = useTeacherRole()
const announcementStore = useAnnouncement()
const assignmentsApi = useAssignments()

// Unified practice state - tag-driven, no modes
const practice = useDealPractice()
// Declarer-play lessons (Hold_Up_3N, Finesse_Simple, …) run on the live
// card-play engine instead of the step walk. Isolated path — the normal bid /
// choose-card lessons never touch `cardplay`, so Baker Bridge is unaffected.
const cardplay = useCardPlay()

// Per-client arrangement axis (a1 grid-flip). Default 'grid' — A1 was cut over to the
// grid arranger in production (slice 1.6b, 2026-07-15). `?arrangement=legacy` is the
// per-client escape hatch (persisted to localStorage) until slice 1.7 retires legacy;
// `?arrangement=grid` reverts to the default. The bug-report snapshot records which
// arrangement the reporter was on, and the practice interface renders the grid branch
// when this is 'grid'.
const { arrangement, arrangementSource } = useArrangement()

// Grid-branch derivations (a1 grid-flip 1.6a). Canonical phase + hero seat for the
// arranger, whether to pin the completed auction (declarer play), and one card-click
// dispatcher so the grid's single @card-click routes to the right handler. (Computed
// getters are deferred, so referencing later-defined refs like isDeclarerPlay is fine.)
const gridPhase = computed(() => a1DerivedPhase())
const gridHeroSeat = computed(() =>
  isDeclarerPlay.value ? (currentDeal.value?.studentSeat || 'S') : (practice.studentSeat.value || 'S'),
)
function onGridCardClick(payload) {
  if (isDeclarerPlay.value) onDeclarerCard(payload)
  else onCardClick(payload)
}
// Defensive-signals / choose-card cardplay (step machine, not the declarer-play engine):
// played cards arrive via [showcards]. Seats that show ONLY a played card (E/S in a defence
// scene) are moved into a CENTRE trick and hidden as seats, so they don't floor the table
// as full-reserve hands and scatter as tiny label-less chips (a1 grid-flip trick composition).
const gridPlayedOnlySeats = computed(() =>
  isDeclarerPlay.value ? [] : playedCardOnlySeats(practice.currentShowcards.value, practice.showcardsPlayedCards.value),
)
const gridDefensePlay = computed(() => gridPlayedOnlySeats.value.length > 0)
// The centre trick = the played-card-only seats' cards (currentShowcards: E/S) PLUS the
// FULLY-SHOWN seats' played cards (showcardsPlayedCards: the hero's led card, struck in its
// hand — e.g. West's ♠K). Without the merge the led card fell out of the trick once its seat
// was fully revealed (2026-07-13 report). A seat with no showcard (dummy, if the PBN omits
// its card) simply isn't in the trick — a lesson-content gap, not an app one.
const gridTrick = computed(() => buildTrickFromShowcards({
  ...(practice.showcardsPlayedCards.value || {}),
  ...(practice.currentShowcards.value || {}),
}))
// Render the centre trick whenever it HAS a card — not only when a hidden seat plays
// (gridDefensePlay). A trick led solely from the fully-shown dummy (e.g. `[showcards
// N:D5]`, board 1) has no played-card-only seat, so gating on gridDefensePlay left the
// ♦5 struck in dummy's hand but absent from the table (2026-07-13 report).
const hasCentreTrick = computed(() => !isDeclarerPlay.value && gridTrick.value.plays.length > 0)
// Hidden seats the grid renders: the deal's own hidden seats plus the played-card-only
// seats (their card lives in the centre trick now, not a scattered seat).
const gridHiddenSeats = computed(() => {
  const base = (isDeclarerPlay.value ? cardplay.hiddenSeats.value : practice.hiddenSeats.value) || []
  return gridDefensePlay.value ? [...new Set([...base, ...gridPlayedOnlySeats.value])] : base
})
// The completed auction has a home per phase: declarer play pins it at NE; a DEFENCE scene
// puts it atop the companion (above the narrative) so NE frees up and the hands/trick expand
// (2026-07-13 report — NE floored the auction to 0.65× and squeezed the seats).
const hasCompletedAuction = computed(() => (currentDeal.value?.auction || []).length > 0)
const pinnedAuction = computed(() => isDeclarerPlay.value && hasCompletedAuction.value)
// A defensive-signals / cardplay lesson, identified by LESSON TYPE — a scripted step lesson
// with no interactive bidding (hasSteps && !hasBidSteps) — rather than by runtime cardplay
// activity. This keeps the layout consistent for the whole lesson: the auction rides atop the
// companion and the centre stays free from the pre-cardplay intro, through the play, into the
// reveal — never snapping to a bidding-anchored centre. gridDefensePlay (played-card-ONLY seats
// present) is too transient for this: it's false during the intro AND at the reveal (all hands
// shown), which is what let the auction snap to centre (2026-07-13 report; Rick: prefer
// consistency for a given lesson type, incl. any pre-cardplay defensive lesson).
const defenceScene = computed(() =>
  !isDeclarerPlay.value && practice.hasSteps.value && !practice.hasBidSteps.value,
)
// Profile-ring override indicator (grid-flip 1.6d): the avatar is green on the default
// (prod) arrangement and orange when this client is on a NON-DEFAULT arrangement. Keyed
// on the VALUE vs DEFAULT_ARRANGEMENT (not on `arrangementSource`, which is provenance:
// `?arrangement=legacy` legitimately resolves source='query' yet is still the default →
// it must read green). Comparing to the DEFAULT_ARRANGEMENT constant stays flip-safe.
const overrideActive = computed(() => arrangement.value !== DEFAULT_ARRANGEMENT)
const companionAuction = computed(() => defenceScene.value && hasCompletedAuction.value)
// Compact status for the grid #nw region (BoardIndicator glyph + StatusStrip), sized to
// the arranger's ~89px status reserve — unlike the full-width DealInfo, which overflowed
// the column and occluded the auction. Same shape A1Scene uses. Nav lives in the
// BoardMasteryStrip above the grid, not the corner.
// Dealer and declarer come from the practice display frame, not the raw deal: after a
// [ROTATE] the table has turned, and the strip has to name the seats the hands are
// actually drawn at ("4♥ by S", matching the authored "South plays 4♥") — #400.
const { status: gridStatus } = useTableStatus({
  phase: gridPhase,
  dealer: computed(() => practice.displayDealer.value),
  vulnerable: computed(() => currentDeal.value?.vulnerable),
  contract: computed(() => (currentDeal.value?.contract
    ? { text: currentDeal.value.contract, declarer: practice.displayDeclarer.value }
    : null)),
  tricks: computed(() => (isDeclarerPlay.value ? cardplay.tricksTaken.value : { NS: 0, EW: 0 })),
  // Only a declarer-play lesson is actually played to a result; a bidding or
  // defence walkthrough would otherwise derive one from its zeroed tricks.
  //
  // Wrapped in a computed, NOT passed as the bare ref: `isDeclarerPlay` is
  // declared ~400 lines BELOW this call, so naming it here evaluates it inside
  // setup(), in its temporal dead zone, and MainLayout throws before it mounts.
  // The sibling `tricks` reads the same binding safely only because a computed
  // callback defers the read until after setup has finished.
  played: computed(() => isDeclarerPlay.value),
})

// --- Coaching feedback fade (branch: coaching-feedback-fade) ----------------
// In the bidding scrollback we distinguish three cases:
//   • partner's calls          → always explained (the student needs them)
//   • the student's WRONG call → the full explanation (the teaching)
//   • the student's RIGHT call → a brief, varied, gender-neutral affirmation
// Judgement boards ([ACCEPT]) are a later slice.
const AFFIRMATIONS = [
  'Correct.',
  'Nicely done.',
  "That's it.",
  'Exactly right.',
  'Spot on.',
  'Well judged.',
  'Right on the money.',
  'Good — that is the call.',
]

// A stable affirmation for a given step so it varies through a board without
// flickering on re-render.
function affirmationFor(idx) {
  const i = ((idx % AFFIRMATIONS.length) + AFFIRMATIONS.length) % AFFIRMATIONS.length
  return AFFIRMATIONS[i]
}

// The call itself, with a colored suit symbol, to prefix the nod: "1♥ — Correct."
function bidLabel(bid) {
  return bid ? formatBid(bid).html : ''
}

// Did the student answer this bid step wrong? (wrong → show its explanation)
function wasStepWrong(idx) {
  return !!practice.boardState.wrongStepIndices[idx]
}

// Did the student choose an accepted alternative here? (also shows the explanation,
// and withholds the perfect-board cheer.)
function wasStepAlternative(idx) {
  return !!practice.boardState.altStepIndices[idx]
}

// Reframe note for an accepted-alternative step (issue #67). The step's
// explanation prose is authored second-person about the RECORDED call
// ("you stretch to 5♦"), so a student who took a defensible alternative would
// otherwise read a paragraph narrating a call they didn't make. Prefix it with
// this note so the prose reads as the reasoning behind the recorded line the
// lesson follows. Content-free — no PBN edits. `step.bid` is the recorded call.
function reframeNoteHtml(step) {
  const call = step?.bid ? formatBid(step.bid).html : 'the recorded call'
  return `Your call was an accepted alternative. The lesson follows the recorded ${call} — the thinking behind it:`
}

// Was this bid step the student's own call (vs partner's auto-played call)?
function isStudentBidStep(idx) {
  return !!practice.boardState.studentBidStepIndices[idx]
}

// Board-level cheer when EVERY call/card on the board was right (shown at completion).
const CELEBRATIONS = ['Bravo!', 'Perfect!', 'Beautifully bid!', 'Flawless — every call!', 'Nailed the whole auction!']
// Card-play / opening-lead lessons get play-appropriate wording, not "bid"
// (B6: a lead lesson was cheering "Beautifully bid!").
const CELEBRATIONS_PLAY = ['Bravo!', 'Perfect!', 'Beautifully played!', 'Flawless — every card!', 'Nailed it!']
const boardCelebration = computed(() => {
  if (!practice.isComplete.value || practice.boardState.boardHadWrong) return ''
  // An accepted alternative isn't a flawless board — withhold the perfect-board cheer.
  if (Object.keys(practice.boardState.altStepIndices).length > 0) return ''
  const set = practice.hasBidSteps.value ? CELEBRATIONS : CELEBRATIONS_PLAY
  return set[practice.steps.value.length % set.length]
})
// ---------------------------------------------------------------------------

// UI state
const showSettings = ref(false)
const showProgress = ref(false)
const showAccomplishments = ref(false)
const showWelcome = ref(true)
const commentaryContainer = ref(null)

function dismissWelcome() {
  if (showWelcome.value) showWelcome.value = false
}
const currentCollection = ref(null)
const currentLesson = ref(null)  // { id, name, category }
const showBecomeTeacher = ref(false)

// Report-a-Problem modal. reportContext is a snapshot of the lesson/board state
// captured at the moment the learner clicks the button (so it doesn't drift if
// the auction advances behind the modal).
const showReport = ref(false)
const reportContext = ref({})
const reportAnchor = ref(null)  // the button's rect, so the popup opens just below it

// Scenario-chat popup: the .btn @chat for the open David Bailey scenario,
// auto-shown when a lesson opens and reopenable from the header. { title, text } or null.

// Local mastery override: force board circle statuses during/after play
// { [boardNumber]: 'red'|'yellow'|'green' }
const forceBoardStatus = ref({})
const boardStatusApi = useBoardStatus()

// Wild-mastery ("Fresh paw") celebration. usePawCelebration queues a paw when
// board-status refetch reveals a newly-earned Fresh paw for the logged-in user;
// we surface one at a time as a brief toast.
const pawCelebration = usePawCelebration()
const activePaw = ref(null)
watch(pawCelebration.pendingCelebrations, (list) => {
  if (activePaw.value || !list.length) return
  activePaw.value = pawCelebration.shiftCelebration()
  setTimeout(() => { activePaw.value = null }, 6000)
}, { deep: true })
const pawLessonName = computed(() =>
  activePaw.value ? useAccomplishments().formatLessonName(activePaw.value.subfolder) : ''
)

// Exercise context for assignment-scoped mastery (null when not in exercise mode)
const exerciseContext = ref(null)

// Intro PDF state
const introUrl = ref(null)
const showIntroPdf = ref(false)
const showRegistrationToast = ref(false)
const introPdfUrl = ref(null)
// Live {x,w} of the floating intro viewer (or null). The practice layout reserves
// a left gutter — and reflows — ONLY when the viewer is docked (a global user
// preference; default float). Floating overlays the content with no reflow, so
// opening/closing no longer shifts the whole GUI. The gutter tracks the docked
// viewer's real right edge.
const introDocked = computed(() => appConfig.uiPrefs.value.introDock === 'dock')
// True while the async intro-availability check is in flight (desktop). When
// docked, we reserve the gutter during this window so the table paints in its
// docked width up front, instead of full-width → squish once the panel opens.
const introChecking = ref(false)
// Reserve the gutter for a docked viewer that's open OR about to open.
const introReserved = computed(() => introDocked.value && (showIntroPdf.value || introChecking.value))
const introGeometry = ref(null)
const introGutter = computed(() => {
  if (!introReserved.value) return null
  const g = introGeometry.value
  // No geometry yet (panel still opening): reserve the default width so the
  // table doesn't shift when the viewer reports its real edge a moment later.
  if (!g) return '574px'
  return `${Math.round(g.x + g.w + 16)}px`
})

// Auto-scroll to show current element (keep its first line visible)
function scrollToCurrentElement(container, selector = '.current') {
  if (!container) return
  const currentEl = container.querySelector(selector)
  if (currentEl) {
    // Scroll so the current element's top is at the top of the visible area
    container.scrollTop = currentEl.offsetTop - container.offsetTop
  }
}

// Cap the coaching text so the bidding controls stay on screen. The scrollable
// text area fills the gap between its top and (window bottom − controls height);
// as coaching grows, older text scrolls out the top instead of pushing the bid
// box below the window.
function fitCommentaryHeight() {
  const el = commentaryContainer.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  const controls = el.parentElement?.querySelector('.commentary-controls')
  const controlsH = controls ? controls.offsetHeight : 0
  const avail = window.innerHeight - top - controlsH - 20
  el.style.maxHeight = Math.max(120, avail) + 'px'
}

// Re-fit, then scroll the current step to the top (older text slides out the top).
// The nextTick fit can read a transient layout: on completion the grid re-lays out
// (phase change → shrink-wrap / height-fit) over the next frame(s), which moves the
// commentary's top, and a two-column layout may only settle after that. Re-fit once
// more on a settle frame so the text area claims the real available height instead of
// a stale (too-short) value — the iPad review otherwise crammed the narrative into the
// 120px floor beside a screen with ~900px free (2026-07-13 report).
function refreshCommentary() {
  nextTick(() => {
    fitCommentaryHeight()
    scrollToCurrentElement(commentaryContainer.value, '.narrative-text.current')
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fitCommentaryHeight()
        scrollToCurrentElement(commentaryContainer.value, '.narrative-text.current')
      }))
    }
  })
}

// Recompute on step change, bid prompt toggling, completion, and deal change.
watch(() => practice.currentStepIndex.value, refreshCommentary)
watch(() => practice.hasBidPrompt.value, refreshCommentary)
watch(() => practice.isComplete.value, refreshCommentary)
watch(() => practice.currentDeal.value, refreshCommentary)

onMounted(() => {
  refreshCommentary()
  window.addEventListener('resize', fitCommentaryHeight)
})
onUnmounted(() => window.removeEventListener('resize', fitCommentaryHeight))


// User state
const isAuthenticated = computed(() => userStore.isAuthenticated.value)

const userName = computed(() => {
  const user = userStore.currentUser.value
  return user ? `${user.firstName} ${user.lastName}` : ''
})

const firstName = computed(() => userStore.currentUser.value?.firstName || '')
const isViewingAs = computed(() => userStore.isViewingAs.value)
const viewedUserName = computed(() => {
  const u = userStore.currentUser.value
  return u ? `${u.firstName} ${u.lastName}` : ''
})

function handleStopViewing() {
  userStore.stopViewingAs()
}

const userInitials = computed(() => {
  const user = userStore.currentUser.value
  if (!user) return '?'
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
})

const appTitle = computed(() => {
  if (appConfig.teacherName.value) {
    return `${appConfig.teacherName.value}'s Bridge Classroom`
  }
  return 'Bridge Classroom'
})

// Announcement polling (every 5 minutes)
let announcementPollInterval = null
onMounted(() => {
  announcementStore.loadAnnouncement()
  announcementPollInterval = setInterval(() => announcementStore.loadAnnouncement(), 5 * 60 * 1000)
})
onUnmounted(() => {
  if (announcementPollInterval) clearInterval(announcementPollInterval)
})

// Initialize on mount
onMounted(async () => {
  appConfig.initializeFromUrl()
  userStore.initialize()

  // If a recovery link was clicked while another user is logged in,
  // clear current user so WelcomeScreen renders and handles the claim
  const urlParams = new URLSearchParams(window.location.search)
  const claimingRecovery = !!(urlParams.get('recover') && urlParams.get('user_id'))
  if (claimingRecovery && userStore.isAuthenticated.value) {
    userStore.stopViewingAs()
    userStore.currentUserId.value = null
  }

  // ADR-0004 Phase 3: if localStorage was purged (Safari ITP) but the durable
  // session cookie survives, silently restore identity + key material before we
  // decide to show the WelcomeScreen — a week-old emailed link just logs in. Skip
  // when a recovery link is being claimed (that flow owns identity) or when we're
  // already authenticated locally. No-op if there is no valid session cookie.
  if (!claimingRecovery && !userStore.isAuthenticated.value) {
    await userStore.restoreSessionFromCookie()
  } else if (!claimingRecovery && userStore.isAuthenticated.value) {
    // ADR-0004 Phase 3b (Path A): already logged in from localStorage, but this
    // device may have no durable cookie yet (pre-feature login / never re-claimed).
    // Silently mint one for any teacher on the device so a future ITP purge is
    // survivable. Fire-and-forget — must never delay startup.
    userStore.backfillSessionCookie()
  }

  assignmentStore.initializeFromUrl()
  practice.observationStore.initialize()

  // Check for collection and lesson in URL
  const collectionFromUrl = appConfig.getCollectionFromUrl()
  const lessonFromUrl = appConfig.getLessonFromUrl()

  if (collectionFromUrl) {
    currentCollection.value = collectionFromUrl

    // If lesson is also specified, auto-load it
    if (lessonFromUrl) {
      await loadLessonFromUrl(collectionFromUrl, lessonFromUrl)
    }
  }

  // Initialize data sync (fetches teacher key, registers user, syncs pending data)
  if (userStore.isAuthenticated.value) {
    await dataSync.initialize()
    // Sync role from server (picks up admin/teacher changes made server-side)
    await userStore.syncRole()
    // Load accomplishments data so board mastery strip can show prior observations
    const accomplishments = useAccomplishments()
    accomplishments.initialize()
    // Check if this user is a teacher
    await teacherRole.checkTeacherStatus()
  }
})

// User flow handlers
async function handleUserReady(user) {
  // User is now authenticated, app will show main content
  console.log('User ready:', user.firstName, user.lastName)
  showWelcome.value = true

  // Show brief registration toast if this is a new user (key backup modal was triggered)
  if (userStore.showKeyBackupModal.value) {
    userStore.dismissKeyBackupModal()
    showRegistrationToast.value = true
    setTimeout(() => { showRegistrationToast.value = false }, 4000)
  }

  // Initialize data sync for the new user (register with server, fetch teacher key)
  await dataSync.initialize()
  // Load accomplishments data for board mastery strip
  const accomplishments = useAccomplishments()
  accomplishments.initialize()
  // Check if this user is a teacher
  await teacherRole.checkTeacherStatus()

  // Check for pending classroom join (user was redirected here from /join/:code to sign in)
  const pendingJoinCode = sessionStorage.getItem('pendingJoinCode')
  if (pendingJoinCode) {
    sessionStorage.removeItem('pendingJoinCode')
    router.push({ name: 'join', params: { joinCode: pendingJoinCode } })
    return
  }
}

async function handleSwitchUser() {
  // §C2: flush the outgoing user's queue BEFORE wiping it. reset() persists an
  // empty pending array, so without this any observations recorded offline or
  // inside the 5s sync debounce were silently discarded on switch. Best-effort:
  // if offline the flush no-ops, but we still must clear so the next user never
  // inherits the previous user's queue.
  try {
    await dataSync.forceSync()
  } catch (e) {
    // Non-fatal — proceed with the switch regardless.
  }

  // Clear all cached per-user data before switching
  useAccomplishments().reset()
  useStudentProgress().clearCache()
  useObservationStore().reset()
  teacherRole.reset()

  // Clear loaded deals and practice state
  deals.value = []
  currentDealIndex.value = 0
  currentCollection.value = null
  currentLesson.value = null
  exerciseContext.value = null
  practice.resetStats()
  appConfig.setCollectionInUrl(null)
  appConfig.setLessonInUrl(null)

  // §C2: also clear per-user UI state that otherwise leaks into the next user's
  // session (e.g. forceBoardStatus mastery-circle colors briefly showing the
  // previous user's play on the same lesson).
  forceBoardStatus.value = {}
  introUrl.value = null
  showIntroPdf.value = false
  reportContext.value = {}

  // Exit any active view-as session and clear current user to show welcome screen
  userStore.stopViewingAs()
  userStore.currentUserId.value = null
  showSettings.value = false
}

// Handle teacher role activation from BecomeTeacherModal
async function handleTeacherActivated() {
  showBecomeTeacher.value = false
  // Refresh teacher status
  await teacherRole.checkTeacherStatus()
}

// Deals data
const deals = ref([])
const currentDealIndex = ref(0)


// Current deal
const currentDeal = computed(() => deals.value[currentDealIndex.value] || null)

// Local prerelease map for the mastery strip, keyed the same way as its
// boardNumbers prop. A board is beta when its deal isn't `stable` (ADR-0001,
// default-deny). Lets the strip draw triangles from local data immediately,
// instead of flashing circles until server board-status loads.
const prereleaseByBoard = computed(() => {
  const map = {}
  for (const d of deals.value) {
    map[d.displayNumber] = d.stable !== true
  }
  return map
})

const dealTitle = computed(() => {
  const collection = getCollection(currentCollection.value)
  const prefix = collection?.name ? `${collection.name} - ` : ''
  // Use the TOC lesson name if available (e.g., "Negative Doubles")
  if (currentLesson.value?.name) return prefix + currentLesson.value.name
  if (!currentDeal.value) return ''
  const name = currentDeal.value.subfolder || currentDeal.value.category || ''
  return name ? prefix + name : ''
})

// Load deal when index changes (safety net - primary calls are in nextDeal/gotoDeal)
watch(currentDealIndex, () => {
  if (currentDeal.value) {
    practice.loadDeal(currentDeal.value)
    appConfig.setDealInUrl(currentDeal.value.boardNumber)
  }
}, { flush: 'sync' })

// ── Declarer-play lessons ────────────────────────────────────────────────
// A board is declarer-play when the parser attached a recorded [Play] line.
// The student declares (South + dummy North); the two defenders replay the
// shipped double-dummy line via the ReplayBot. One watcher on currentDeal
// covers every load path (lesson load, nextDeal, gotoDeal, index change).
const DUMMY_OF = { N: 'S', S: 'N', E: 'W', W: 'E' }
const SIDE_OF = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' }

const isDeclarerPlay = computed(() => !!(currentDeal.value?.isDeclarerPlay && currentDeal.value?.playLine))
const declarerSide = computed(() => SIDE_OF[currentDeal.value?.declarer || 'S'])
const tricksNeeded = computed(() => {
  const c = currentDeal.value?.contract
  const lvl = c && /^[1-7]/.test(c) ? parseInt(c[0], 10) : null
  return lvl ? lvl + 6 : null
})

// Which coaching tip to surface as play progresses.
const declarerCoachingText = computed(() => {
  const pc = currentDeal.value?.playCoaching
  if (!pc) return ''
  if (cardplay.playComplete.value) return pc['post-play'] || pc['auction-end'] || ''
  if (cardplay.played.value.length > 0 && pc['post-lead']) return pc['post-lead']
  return pc['auction-end'] || pc['pre-lead'] || ''
})

function startDeclarerPlay(deal) {
  const declarer = deal.declarer || 'S'
  cardplay.startPlay({
    hands: deal.hands,
    dealer: deal.dealer,
    vulnerable: deal.vulnerable,
    bids: deal.auction || [],
    contract: deal.contract,
    declarer,
    bot: makeReplayBot(deal.playLine.bySeat),
    userSeats: [declarer, DUMMY_OF[declarer]],
    pacing: { betweenPlays: 550, betweenTricks: 1300 },
  })
}

async function onDeclarerCard({ suit, rank }) {
  await cardplay.onUserCard(suit, rank)
}

watch(currentDeal, (deal) => {
  if (deal?.isDeclarerPlay && deal?.playLine) {
    startDeclarerPlay(deal)
  } else if (cardplay.isActive.value) {
    cardplay.reset()
  }
}, { immediate: true })

// Trigger sync when new observations are recorded
watch(() => practice.observationStore.pendingCount.value, (newCount, oldCount) => {
  if (newCount > oldCount) {
    // New observation was recorded, trigger debounced sync
    dataSync.triggerSync()
  }
})

// Set final board status when deal completes (persists until API refreshes)
watch(() => practice.isComplete.value, (isComplete) => {
  if (isComplete && currentDeal.value) {
    const board = currentDeal.value.displayNumber
    const hadWrong = practice.boardState.boardHadWrong
    const allFixed = hadWrong && Object.keys(practice.boardState.wrongStepIndices).length === 0
    const status = !hadWrong ? 'green' : allFixed ? 'yellow' : 'red'
    forceBoardStatus.value = { ...forceBoardStatus.value, [board]: status }
  }
})

// Note: forceBoardStatus is NOT cleared on cache refresh — the local override
// persists for the session to avoid a grey flicker between cache invalidation
// and the API response arriving. Both use the same status logic so they agree.

// Single choke point for committing the deal list. Stamps each deal with its
// canonical strip identity, `displayNumber` — the ONE key the board strip,
// forceBoardStatus, and prerelease map all use. In assignment/exercise mode
// boards are pulled out of their source order, so they're renumbered 1..N;
// everywhere else displayNumber mirrors the deal's own boardNumber, so free
// practice still shows the PBN board numbers. Assigning it here (rather than
// re-deriving `displayNumber || boardNumber` at each read site) means the
// identity always exists and can't be forgotten — a forgotten fallback in the
// deal-complete watcher is what let a status write land on the wrong board
// (bug-artifacts #33).
function setDeals(list, { renumber = false } = {}) {
  list.forEach((deal, i) => {
    deal.displayNumber = renumber ? i + 1 : deal.boardNumber
  })
  deals.value = list
  return list
}

// File handling
async function onFileSelect(event) {
  const file = event.target.files[0]
  if (!file) return

  try {
    const content = await file.text()
    const parsed = parsePbn(content)
    if (parsed.length > 0) {
      // Extract category from filename (e.g., 'Cue-bid.pbn' -> 'Cue-bid')
      const category = file.name.replace(/\.pbn$/i, '')
      const dealsWithCategory = parsed.map(deal => ({
        ...deal,
        subfolder: deal.subfolder || category,
        category: deal.category || category,
        collectionId: currentCollection.value || null
      }))
      setDeals(dealsWithCategory)
      currentDealIndex.value = 0
      practice.loadDeal(dealsWithCategory[0])
      practice.resetStats()

      // Cache board numbers for mastery tracking (same as collection lessons)
      const boardMastery = useBoardMastery()
      boardMastery.saveLessonBoardNumbers(category, dealsWithCategory.map(d => d.boardNumber))

      currentLesson.value = { id: category, name: category, category }
    } else {
      alert('No deals found in the PBN file')
    }
  } catch (err) {
    console.error('Error loading PBN file:', err)
    alert('Error loading PBN file: ' + err.message)
  }
}

async function loadBundledFile(file) {
  try {
    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Failed to fetch file')
    const content = await response.text()
    const parsed = parsePbn(content)
    if (parsed.length > 0) {
      // Set the subfolder/category on each deal for skill tracking
      const dealsWithCategory = parsed.map(deal => ({
        ...deal,
        subfolder: file.name,
        category: file.name,
        collectionId: currentCollection.value || null
      }))
      setDeals(dealsWithCategory)
      currentDealIndex.value = 0
      practice.loadDeal(dealsWithCategory[0])
      practice.resetStats()
    }
  } catch (err) {
    console.error('Error loading bundled file:', err)
    alert('Error loading file: ' + err.message)
  }
}

// Handle lesson loaded from LessonBrowser
function handleLessonLoad({ subfolder, name, category, content }) {
  const parsed = parsePbn(content)
  if (parsed.length > 0) {
    const dealsWithCategory = parsed.map(deal => ({
      ...deal,
      subfolder: deal.subfolder || subfolder,
      category: deal.category || category,
      collectionId: currentCollection.value || null
    }))
    setDeals(dealsWithCategory)
    currentDealIndex.value = 0
    practice.loadDeal(dealsWithCategory[0])
    practice.resetStats()

    // Cache board numbers for progress views. (Collection scope is no longer
    // cached here — progress views read collection_id straight from the
    // board_status / lesson-mastery rollups, which carry it per row.)
    const boardMastery = useBoardMastery()
    boardMastery.saveLessonBoardNumbers(subfolder, dealsWithCategory.map(d => d.boardNumber))

    // Store lesson metadata and update URL
    currentLesson.value = { id: subfolder, name, category }
    appConfig.setLessonInUrl(subfolder)
    showIntroPdf.value = false
    checkIntroAvailability()
  } else {
    alert('No deals found in the lesson file')
  }
}

// Board-level stats
const totalCorrect = computed(() => practice.boardState.correctCount)
const totalWrong = computed(() => practice.boardState.wrongCount)

// Bidding
function onBid(bid) {
  const correct = practice.makeBid(bid)
  if (currentDeal.value) {
    updateBoardOverride(correct)
  }
}

// Card choice
function onCardClick({ seat, suit, rank }) {
  const correct = practice.makeCardChoice(suit, rank)
  if (currentDeal.value) {
    updateBoardOverride(correct)
  }
}

function updateBoardOverride(correct) {
  const board = currentDeal.value.displayNumber
  if (!correct) {
    forceBoardStatus.value = { ...forceBoardStatus.value, [board]: 'red' }
  } else if (practice.boardState.boardHadWrong) {
    const allFixed = Object.keys(practice.boardState.wrongStepIndices).length === 0
    forceBoardStatus.value = { ...forceBoardStatus.value, [board]: allFixed ? 'yellow' : 'red' }
  }
}

// Step back (clears card feedback before going back)
function onStepBack() {
  practice.clearCardFeedback()
  practice.goBack()
}

// Navigation
function prevDeal() {
  if (currentDealIndex.value > 0) {
    currentDealIndex.value--
  }
}

function nextDeal() {
  if (currentDealIndex.value < deals.value.length - 1) {
    currentDealIndex.value++
    practice.loadDeal(deals.value[currentDealIndex.value])
  }
}

function gotoDeal(index) {
  if (index >= 0 && index < deals.value.length) {
    currentDealIndex.value = index
    practice.loadDeal(deals.value[index])
  }
}

// Navigate to a specific deal from a modal view
async function navigateToDeal({ subfolder, dealNumber }) {
  // If the current lesson matches, just navigate to the deal
  if (currentLesson.value?.id === subfolder && deals.value.length > 0) {
    const index = deals.value.findIndex(d => d.boardNumber === dealNumber)
    if (index >= 0) {
      gotoDeal(index)
      return
    }
  }

  // Otherwise, try to load the lesson from known collections
  for (const collection of appConfig.COLLECTIONS) {
    try {
      const filename = subfolder.includes('/') ? subfolder.split('/').pop() : subfolder
      const url = `${collection.baseUrl}/${filename}.pbn`
      const response = await fetch(url)
      if (!response.ok) continue

      const content = await response.text()
      currentCollection.value = collection.id
      appConfig.setCollectionInUrl(collection.id)
      handleLessonLoad({ subfolder, name: subfolder, category: '', content })

      // Navigate to the specific deal
      const index = deals.value.findIndex(d => d.boardNumber === dealNumber)
      if (index >= 0) {
        gotoDeal(index)
      }
      return
    } catch {
      // Try next collection
    }
  }
}

function handleNavigateToDeal(payload) {
  showAccomplishments.value = false
  navigateToDeal(payload)
}

function handleResumeLesson({ subfolder, dealNumber }) {
  if (userStore.isViewingAs.value) return
  navigateToDeal({ subfolder, dealNumber })
}

function handleTeacherNavigateToLesson(subfolder, boardNumber) {
  if (userStore.isViewingAs.value) return
  navigateToDeal({ subfolder, dealNumber: boardNumber || 1 })
}

// Return to lesson browser (keep collection, clear deals)
function returnToLessons() {
  currentLesson.value = null
  appConfig.setLessonInUrl(null)
  deals.value = []
  currentDealIndex.value = 0
  practice.resetStats()
  showIntroPdf.value = false
  introUrl.value = null
  exerciseContext.value = null
}

// Return to lobby (exit collection and clear deals)
function returnToLobby() {
  currentCollection.value = null
  currentLesson.value = null
  appConfig.setCollectionInUrl(null)
  appConfig.setLessonInUrl(null)
  deals.value = []
  currentDealIndex.value = 0
  practice.resetStats()
  showIntroPdf.value = false
  introUrl.value = null
  exerciseContext.value = null
  // Exit assignment mode so the next free-form practice doesn't
  // inherit a stale assignment_id / exercise_id (issue #7).
  assignmentStore.exitAssignmentMode()
}

// Has the student already finished at least one board in the current lesson?
// Drives whether the intro AUTO-opens (issue #12): auto-display only until they've
// completed their first board; afterwards the Intro button still opens it on demand,
// but it no longer interrupts on entry. Reads server board-status (persists across
// sessions/devices) — any board past 'not_attempted' counts (played, right or wrong) —
// plus any just-completed local pending observation, so a same-session re-entry before
// sync doesn't re-interrupt. Same subfolder/collection scope BoardMasteryStrip uses, so
// it shares that cache. Fail-open to FALSE (→ keep auto-opening) when signed out /
// offline / unknown.
async function hasCompletedBoardInLesson() {
  const uid = userStore.currentUser.value?.id
  const subfolder = currentDeal.value?.subfolder || currentDeal.value?.category || currentLesson.value?.id
  if (!uid || !subfolder) return false
  try {
    // Reuse the SAME board-status the board strip shows — one source of truth, not a
    // divergent second query (Rick, 2026-07-13). Both read the useBoardStatus singleton
    // cache under the identical (subfolder, collectionId) scope. The scope is the loaded
    // deal's own collectionId — the same value passed to the strip's :collectionId prop —
    // NOT a `|| currentCollection` fallback (the earlier fallback scoped the query and
    // filtered OUT completed rows with a null/mismatched collection_id — defence lessons —
    // so the strip showed the board green while this gate saw "not completed" and
    // re-opened the intro every visit). Read the strip's cached result first; only fetch
    // if the strip hasn't populated it yet (e.g. this gate runs before the strip mounts).
    const collectionId = currentDeal.value?.collectionId || null
    const boards = boardStatusApi.getCachedBoards(uid, subfolder, collectionId)
      || await boardStatusApi.fetchBoardStatus(uid, subfolder, false, collectionId)
    if ((boards || []).some(b => b?.status && b.status !== 'not_attempted')) return true
  } catch { /* offline / API error → fall through to pending, then fail-open */ }
  try {
    const pending = useObservationStore().getPendingObservations()
    if (pending.some(o => o?.metadata?.deal_subfolder === subfolder)) return true
  } catch { /* observation store unavailable */ }
  return false
}

// Check if an intro PDF exists for the current lesson
async function checkIntroAvailability() {
  introUrl.value = null
  if (!currentCollection.value || !currentLesson.value) return

  const collection = getCollection(currentCollection.value)
  if (!collection) return

  const lessonId = currentLesson.value.id
  const filename = lessonId.includes('/') ? lessonId.split('/').pop() : lessonId
  const url = `${collection.baseUrl}/${filename}_Intro.pdf`

  // Desktop auto-opens the intro — but only until the student has completed their first
  // board in this lesson (issue #12); after that it stays reachable via the Intro button
  // without interrupting on entry. Shared by BOTH shells, so this covers prod (legacy)
  // and the beta (grid). If auto-opening AND the pref is docked, reserve the gutter NOW
  // (before the availability round-trip) so the table paints at its docked width and the
  // panel slides into reserved space — no full-width → squish flash.
  const desktop = window.innerWidth >= 600
  const autoOpen = desktop && !(await hasCompletedBoardInLesson())
  if (autoOpen) introChecking.value = true

  try {
    const response = await fetch(url, { method: 'HEAD' })
    if (response.ok) {
      introUrl.value = url // the Intro button shows whenever a PDF exists, regardless of auto-open
      if (autoOpen) {
        introPdfUrl.value = url
        showIntroPdf.value = true // now drives the gutter; introChecking clears below
      }
    }
  } catch {
    // Network error or CORS issue - silently hide button
  } finally {
    introChecking.value = false
  }
}

// Open intro PDF (floating viewer on desktop, new tab on mobile)
function handleOpenIntro(url) {
  if (window.innerWidth < 600) {
    window.open(url, '_blank')
  } else {
    introPdfUrl.value = url
    showIntroPdf.value = true
  }
}

// Select a lesson collection (updates URL and shows inline lesson browser)
function selectCollection(collectionId) {
  if (userStore.isViewingAs.value) return
  currentCollection.value = collectionId
  appConfig.setCollectionInUrl(collectionId)
}

/**
 * Handle student clicking an assignment card.
 * Fetches the exercise's board list, loads the corresponding PBN files,
 * filters to just the assigned boards, and enters practice mode.
 */
async function handleSelectAssignment(assignment) {
  if (userStore.isViewingAs.value) return
  const boards = await assignmentsApi.fetchExerciseBoards(assignment.exercise_id)
  if (!boards || boards.length === 0) {
    alert('Could not load exercise boards.')
    return
  }

  // Group boards by subfolder+collection so we fetch each PBN file once
  const groupKey = (b) => `${b.collection_id || ''}|${b.deal_subfolder}`
  const byGroup = new Map()
  for (const b of boards) {
    const key = groupKey(b)
    if (!byGroup.has(key)) {
      byGroup.set(key, [])
    }
    byGroup.get(key).push(b)
  }

  const allDeals = []

  for (const [, boardRefs] of byGroup) {
    const subfolder = boardRefs[0].deal_subfolder
    const collectionId = boardRefs[0].collection_id
    const filename = subfolder.includes('/') ? subfolder.split('/').pop() : subfolder
    let content = null

    // If collection_id is set, go directly to the right collection
    if (collectionId) {
      const collection = getCollection(collectionId)
      if (collection) {
        try {
          const url = `${collection.baseUrl}/${filename}.pbn`
          const response = await fetch(url)
          if (response.ok) {
            content = await response.text()
          }
        } catch {
          // Fall through to try all collections
        }
      }
    }

    // Fallback: try each collection
    if (!content) {
      for (const collection of appConfig.COLLECTIONS) {
        try {
          const url = `${collection.baseUrl}/${filename}.pbn`
          const response = await fetch(url)
          if (response.ok) {
            content = await response.text()
            break
          }
        } catch {
          // Try next collection
        }
      }
    }

    if (!content) {
      console.warn(`Could not load PBN for subfolder: ${subfolder}`)
      continue
    }

    const parsed = parsePbn(content)
    const wantedNumbers = new Set(boardRefs.map(b => b.deal_number))

    for (const deal of parsed) {
      if (wantedNumbers.has(deal.boardNumber)) {
        const ref = boardRefs.find(b => b.deal_number === deal.boardNumber)
        allDeals.push({
          ...deal,
          subfolder: deal.subfolder || subfolder,
          category: deal.category || subfolder,
          _sortOrder: ref?.sort_order ?? 999
        })
      }
    }
  }

  if (allDeals.length === 0) {
    alert('Could not find any of the assigned boards.')
    return
  }

  // Sort by the exercise's sort_order
  allDeals.sort((a, b) => a._sortOrder - b._sortOrder)

  // Assign sequential display numbers for the exercise (1, 2, ..., N) and commit
  // the list. Renumbered because assignment boards are pulled out of source
  // order; displayNumber is the canonical strip identity (see setDeals).
  setDeals(allDeals, { renumber: true })

  // Build exercise context for assignment-scoped mastery. `assignmentId` lets
  // the board strip read the server's assignment-scoped rollup, which is the
  // only cross-device source of truth (bug-artifacts #32: computing status from
  // local observations alone showed every board grey on a device that hadn't
  // played them, even though the server had the completions).
  exerciseContext.value = {
    assignmentId: assignment.id,
    boards: allDeals.map(d => ({
      displayNumber: d.displayNumber,
      originalSubfolder: d.subfolder,
      originalBoardNumber: d.boardNumber
    })),
    assignedAt: assignment.assigned_at
  }

  // Enter assignment mode in the store so subsequent observations get
  // tagged with assignment_id + exercise_id (issue #7 forward-path
  // fix). Without this, `getAssignmentTag()` returns null and every
  // play submits as untagged free-form practice.
  assignmentStore.setCurrentClassroomAssignment(assignment)

  // Load into practice mode (deals already committed via setDeals above)
  currentDealIndex.value = 0
  practice.loadDeal(allDeals[0])
  practice.resetStats()

  // Cache display numbers for mastery tracking
  const boardMastery = useBoardMastery()
  boardMastery.saveLessonBoardNumbers(
    assignment.exercise_name,
    allDeals.map(d => d.displayNumber)
  )

  currentLesson.value = {
    id: assignment.exercise_name,
    name: assignment.exercise_name,
    category: 'Assignment'
  }
}

// Get collection info by ID
function getCollection(collectionId) {
  return appConfig.COLLECTIONS.find(c => c.id === collectionId)
}

// A board is reportable only when we know which repo to file into (collection
// has a reportRepo). Given that, the collection's `report` property is an
// explicit override:
//   report: true  → force reporting ON for the whole collection (e.g. David's
//                   coaching content, curated as a set regardless of release)
//   report: false → force it OFF, a kill switch (e.g. to disable Baker Bridge)
//   absent        → defer to the board's released flag: `stable` (the same flag
//                   that lets it count toward mastery). So Baker Bridge is
//                   reportable automatically via its file-level
//                   %bridge-classroom-stable, with no per-collection opt-in.
const reportEnabled = computed(() => {
  const collection = getCollection(currentCollection.value)
  if (!collection?.reportRepo) return false
  if (collection.report === true) return true
  if (collection.report === false) return false
  return currentDeal.value?.stable === true
})

// Reconstruct an "N:..." PBN string from parsed hands as a fallback when the
// deal didn't carry its raw [Deal] string (older parses). N E S W order.
function reconstructPbn(hands) {
  if (!hands) return null
  const parts = ['N', 'E', 'S', 'W'].map(seat => {
    const h = hands[seat]
    if (!h) return '...'
    return [h.spades, h.hearts, h.diamonds, h.clubs].map(a => (a || []).join('')).join('.')
  })
  return 'N:' + parts.join(' ')
}

// Snapshot everything the report needs, then open the modal. The app already
// has all of this while rendering the board.
function openReport(e) {
  const deal = currentDeal.value
  if (!deal) return
  // Remember where the button is so the popup opens just below it.
  const btn = e?.currentTarget
  if (btn?.getBoundingClientRect) {
    const r = btn.getBoundingClientRect()
    reportAnchor.value = { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  }
  const collection = getCollection(currentCollection.value)
  const lessonId = currentLesson.value?.id || ''
  const filename = lessonId.includes('/') ? lessonId.split('/').pop() : lessonId
  const sourceUrl = collection && filename ? `${collection.baseUrl}/${filename}.pbn` : null
  const role = userStore.currentUser.value?.role
  const reporterTier = (role === 'teacher' || role === 'admin') ? 'reviewer' : 'learner'

  reportContext.value = {
    collection: currentCollection.value || null,
    lesson_id: lessonId || null,
    lesson_name: currentLesson.value?.name || null,
    scenario: deal.event || lessonId || null,
    deal_pbn: deal.dealString || reconstructPbn(deal.hands),
    display_number: deal.displayNumber || (currentDealIndex.value + 1),
    board_tag: deal.boardNumber != null ? String(deal.boardNumber) : null,
    original_board: deal.originalBoard || null,
    student_seat: practice.studentSeat.value || deal.studentSeat || null,
    auction: [...practice.auctionState.displayedBids],
    contract: deal.contract || null,
    step_index: practice.currentStepIndex.value,
    prompt: practice.currentStep.value?.text || null,
    reporter_tier: reporterTier,
    // Default name the modal pre-fills when the reporter opts out of anonymity.
    // The modal lets them edit it to an alias; email is never attached.
    reporterDefaultName: userStore.currentUser.value?.firstName || null,
    source_url: sourceUrl,
    source_commit: null,
    app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null,
    app_commit: typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : null
  }
  showReport.value = true
}

// Pull the scenario "chat" out of a .btn — the /*@chat ... @chat*/ block.

/**
 * Auto-load lesson from URL parameters
 * Fetches TOC, finds lesson, loads PBN file
 */
async function loadLessonFromUrl(collectionId, lessonId) {
  const collection = getCollection(collectionId)
  if (!collection) {
    console.error('Collection not found:', collectionId)
    return false
  }

  try {
    // Fetch the table of contents
    const tocResponse = await fetch(collection.tocUrl)
    if (!tocResponse.ok) {
      throw new Error(`Failed to load TOC: ${tocResponse.statusText}`)
    }
    const toc = await tocResponse.json()

    // Find the lesson in the TOC
    let foundLesson = null
    let foundCategory = null
    for (const category of toc.categories || []) {
      const lesson = category.lessons?.find(l => l.id === lessonId)
      if (lesson) {
        foundLesson = lesson
        foundCategory = category
        break
      }
    }

    if (!foundLesson) {
      console.error('Lesson not found in TOC:', lessonId)
      return false
    }

    // Build the lesson URL (extract filename from lesson ID)
    const filename = lessonId.includes('/') ? lessonId.split('/').pop() : lessonId
    const lessonUrl = `${collection.baseUrl}/${filename}.pbn`

    // Fetch the lesson PBN file
    const pbnResponse = await fetch(lessonUrl)
    if (!pbnResponse.ok) {
      throw new Error(`Failed to load lesson: ${pbnResponse.statusText}`)
    }
    const content = await pbnResponse.text()

    // Parse and load the deals
    const parsed = parsePbn(content)
    if (parsed.length > 0) {
      const dealsWithCategory = parsed.map(deal => ({
        ...deal,
        subfolder: deal.subfolder || lessonId,
        category: deal.category || foundCategory.name,
        collectionId: collectionId || null
      }))
      setDeals(dealsWithCategory)

      // Restore deal number from URL if present
      const dealNum = appConfig.getDealFromUrl()
      const dealIdx = dealNum ? dealsWithCategory.findIndex(d => d.boardNumber === dealNum) : -1
      currentDealIndex.value = dealIdx >= 0 ? dealIdx : 0
      practice.loadDeal(dealsWithCategory[currentDealIndex.value])
      practice.resetStats()

      // (Collection scope no longer cached here — Recent Lessons reads
      // collection_id from the /lesson-mastery rollup, which carries it.)

      // Store lesson metadata (URL already has the params)
      currentLesson.value = {
        id: lessonId,
        name: foundLesson.name,
        category: foundCategory.name
      }
      checkIntroAvailability()
      return true
    }
    return false
  } catch (err) {
    console.error('Error loading lesson from URL:', err)
    return false
  }
}

// ── A1 bug-report diagnostic provider (a1-grid-flip slice 1.6c) ───────────────
// Register a report-context provider so a beetle tap on the A1 surface captures the
// arrangement, the phase (+ the raw signals it was derived from), lesson/board
// identity, a gallery-loadable fixture, and — under the grid — the arranger's ledger.
// captureReportContext() wraps this in try/catch, so a stray field access degrades to
// null and NEVER breaks report filing. Read-only + opt-in (beetle only), so normal
// users are unaffected. See src/report/captureA1Snapshot.js for the payload + schema.
function readLayoutLedger() {
  try {
    const el = document.querySelector('[data-layout-ledger]')
    return el ? JSON.parse(el.getAttribute('data-layout-ledger')) : null
  } catch { return null }
}
function a1PhaseSignals() {
  return {
    isDeclarerPlay: !!isDeclarerPlay.value,
    auctionComplete: !!practice.auctionState?.auctionComplete,
    showOpeningLead: !!practice.showOpeningLead?.value,
    hasSteps: !!practice.hasSteps?.value,
    hasBidSteps: !!practice.hasBidSteps?.value,
    hasBidPrompt: !!practice.hasBidPrompt?.value,
    hasCardChoice: !!practice.hasCardChoice?.value,
    isComplete: !!practice.isComplete?.value,
  }
}
function a1DerivedPhase() {
  if (isDeclarerPlay.value) return 'play'
  if (defenceScene.value) return 'play' // step-based defensive lesson (signals) — intro through reveal
  if (practice.auctionState?.auctionComplete) return 'review'
  return 'bidding'
}
function a1Fixture() {
  const deal = currentDeal.value || {}
  const play = isDeclarerPlay.value
  return {
    surface: 'a1',
    label: `capture · ${currentCollection.value || 'a1'} · board ${deal.displayNumber ?? deal.boardNumber ?? '?'}`,
    seat: play ? (deal.studentSeat || 'S') : (practice.studentSeat?.value || 'S'),
    heroName: firstName.value || null,
    board: deal.displayNumber ?? deal.boardNumber ?? null,
    dealer: deal.dealer || null,
    vulnerable: deal.vulnerable || null,
    phase: a1DerivedPhase(),
    contract: deal.contract || null,
    declarer: deal.declarer || null,
    hands: play ? deal.hands : practice.hands?.value,
    // Effective hidden seats the grid renders (adds the played-card-only seats in a
    // defensive-signals scene, whose card lives in the centre trick).
    hiddenSeats: gridHiddenSeats.value || [],
    clickableSeat: play ? cardplay.clickableSeat?.value : (practice.hasCardChoice?.value ? practice.studentSeat?.value : null),
    playedCards: play ? cardplay.playedBySeat?.value : practice.showcardsPlayedCards?.value,
    bids: deal.auction || [],
    // The centre trick — the live cardplay engine's, or (defensive signals) the one built
    // from the showcards; null in bidding/review.
    currentTrick: play ? cardplay.currentTrick : (gridDefensePlay.value ? gridTrick.value : null),
    lastFinishedTrick: play ? cardplay.lastFinishedTrick?.value : null,
    tricksTaken: play ? cardplay.tricksTaken?.value : null,
  }
}
function a1ReportProvider() {
  const deal = currentDeal.value || {}
  const vp = { w: window.innerWidth, h: window.innerHeight }
  const grid = arrangement.value === 'grid'
  const snapshot = captureA1Snapshot({
    arrangement: { value: arrangement.value, source: arrangementSource.value },
    phase: a1DerivedPhase(),
    phaseSignals: a1PhaseSignals(),
    content: {
      collection: currentCollection.value || null,
      lesson: deal.subfolder || deal.category || null,
      board: deal.displayNumber ?? deal.boardNumber ?? null,
      stepIndex: practice.currentStepIndex?.value ?? null,
      stepCount: practice.steps?.value?.length ?? null,
      dealHash: null, // TODO: hash deal.dealString once the fixture round-trip is exercised
    },
    env: {
      viewport: vp,
      tableScale: null,
      dpr: window.devicePixelRatio || null,
      userAgent: navigator.userAgent || null,
    },
    identity: { userId: userStore.currentUser.value?.id ?? null, classContext: null },
    ledger: readLayoutLedger(),
    tableConfig: grid ? resolveTableConfig(a1Config, a1DerivedPhase(), vp) : null,
    fixture: a1Fixture(),
    capturedAt: Date.now(),
  })
  return a1SnapshotToEnrich(snapshot)
}
onMounted(() => setReportContextProvider(a1ReportProvider))
onUnmounted(() => clearReportContextProvider(a1ReportProvider))
</script>

<style>
.registration-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #2e7d32;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 3000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  animation: toast-fade 4s ease-in-out;
  pointer-events: none;
}

/* Fresh-paw celebration toast. Slightly richer than the registration toast
   (icon + two-line text) and clickable to dismiss. */
.paw-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 460px;
  background: linear-gradient(135deg, #047857, #10b981);
  color: white;
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 14px;
  z-index: 3001;
  box-shadow: 0 6px 20px rgba(4, 120, 87, 0.4);
  cursor: pointer;
  animation: paw-toast-in 0.35s ease-out;
}

.paw-toast-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  animation: paw-bounce 0.6s ease-in-out 2;
}

.paw-toast-text strong { display: block; font-size: 15px; margin-bottom: 1px; }

@keyframes paw-toast-in {
  0% { opacity: 0; transform: translateX(-50%) translateY(-14px) scale(0.96); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}

@keyframes paw-bounce {
  0%, 100% { transform: translateY(0) rotate(0); }
  50% { transform: translateY(-4px) rotate(-8deg); }
}

@keyframes toast-fade {
  0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  10% { opacity: 1; transform: translateX(-50%) translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-body, 'DM Sans', 'Segoe UI', system-ui, -apple-system, sans-serif);
  background: var(--bg-warm, #f5f5f5);
  min-height: 100vh;
}

.app {
  max-width: var(--max-width, 1200px);
  margin: 0 auto;
  padding: 16px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* While the Lesson Introduction is docked at the left edge, go full-width and
   reserve a left gutter the width of the viewer, so the practice content (board
   selector, table, bidding) reflows entirely to the right of the Intro instead
   of hiding behind it. Only on screens wide enough to hold the gutter plus the
   practice layout — narrower screens keep the centered layout (the Intro floats
   over it and can be moved or closed). */
@media (min-width: 1200px) {
  .app.intro-open {
    max-width: none;
    margin: 0;
  }
  /* Gutter tracks the viewer's real right edge (--intro-gutter); falls back to a
     sensible default if geometry hasn't reported yet. */
  .app.intro-open .practice-layout {
    padding-left: var(--intro-gutter, 568px);
    justify-content: start;
  }
}

.view-as-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 8px 14px;
  margin-bottom: 12px;
  background: #fde68a;
  border: 1px solid #f59e0b;
  border-radius: var(--radius-button, 6px);
  color: #78350f;
  font-size: 14px;
}
.view-as-text strong { color: #422006; }
.stop-viewing-btn {
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid #b45309;
  background: #fffbeb;
  color: #78350f;
  border-radius: var(--radius-button, 6px);
  cursor: pointer;
}
.stop-viewing-btn:hover { background: #fef3c7; }

.app-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--card-border, #ddd);
}

.app-header h1 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 24px;
  color: var(--green-dark, #333);
  /* Truncate a long title instead of letting it run into the centered greeting
     or the right-hand controls. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* When the centered "Welcome back" greeting is shown, keep the title left of it
   (the greeting is absolutely centered at 50%). */
.app-header.has-greeting h1 {
  max-width: calc(50% - 120px);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.welcome-greeting {
  position: absolute;
  left: 50%;
  top: calc(50% - 6px);
  transform: translate(-50%, -50%);
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 24px;
  color: var(--green-dark, #2d6a4f);
  font-weight: 700;
  pointer-events: none;
  white-space: nowrap;
}

.user-avatar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stats {
  display: flex;
  gap: 12px;
  font-size: 16px;
  font-weight: bold;
}

.stats .correct {
  color: #4caf50;
}

.stats .correct::before {
  content: '✓ ';
}

.stats .wrong {
  color: #d32f2f;
}

.stats .wrong::before {
  content: '✗ ';
}

.user-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--green-mid, #667eea) 0%, var(--green-dark, #764ba2) 100%);
  color: white;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.user-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(45, 106, 79, 0.4);
}
/* Override-active (Beta preview): orange avatar — this client is pinned to a non-default
   arrangement. Background swap only, zero layout impact. */
.user-btn-beta {
  background: linear-gradient(135deg, #f0932b 0%, #d35400 100%);
}
.user-btn-beta:hover {
  box-shadow: 0 2px 8px rgba(211, 84, 0, 0.45);
}

.progress-btn {
  padding: 6px 12px;
  border-radius: 16px;
  background: #f0f0f0;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.progress-btn:hover {
  background: #e0e0e0;
  color: #333;
}

.accomplishments-btn {
  padding: 6px 12px;
  border-radius: 16px;
  background: #e8f5e9;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: #388e3c;
  cursor: pointer;
  transition: all 0.2s;
}

.accomplishments-btn:hover {
  background: #c8e6c9;
  color: #2e7d32;
}

.lessons-btn {
  padding: 6px 12px;
  border-radius: 16px;
  background: #e3f2fd;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: #1976d2;
  cursor: pointer;
  transition: all 0.2s;
}

.lessons-btn:hover {
  background: #bbdefb;
  color: #1565c0;
}

.lobby-btn {
  padding: 6px 12px;
  border-radius: 16px;
  background: #fff3e0;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: #e65100;
  cursor: pointer;
  transition: all 0.2s;
}

.lobby-btn:hover {
  background: #ffe0b2;
  color: #bf360c;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  z-index: 1000;
  padding: 20px;
}

.app-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

/* Two-column practice layout for desktop */
.practice-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 500px;
  gap: 32px;
  align-items: start;
  justify-content: center;
}

.practice-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* TEMP (2026-07-11) — quick fix pending the grid-arranger reintegration.
   The a1 hand box shrink-wraps: SeatPanel's `min-width: min(180px, 100%)` lets
   the `100%` resolve to the shrink-wrapped parent, so the box collapses to the
   hand's min-content and normal 4–5-card suits compress — each row to a DIFFERENT
   scale (different natural widths), giving one hand four font sizes. Pin a fixed
   width that fits a 7-card suit at full font, so nothing compresses until 8+
   and every suit renders uniform.
   NOTE: this <style> block is UNSCOPED, so NO `:deep()` — `:deep()` is a
   scoped-CSS-only selector and in a global block it's invalid CSS that makes the
   browser drop the whole rule (which is why the earlier `:deep(.seat-panel)`
   version never applied). A plain descendant selector targets it directly. */
.practice-left .seat-panel {
  min-width: 240px !important;
}

.practice-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}

/* Grid arrangement (a1 grid-flip 1.6a). Two-column shell: the named-area grid stage
   left, the coaching companion right; stacks under 900px. The grid arranger owns the
   table's internal layout + per-region scale, so this shell only places the stage vs
   the companion (grid-arranger-spec: the shell owns the companion, the grid owns the
   table). The legacy `.practice-left .seat-panel` width pin does NOT reach the grid
   seats (they live under `.practice-grid-stage`), so the arranger's scaling governs. */
.practice-grid-layout {
  /* Flex-wrap, NOT a fixed grid + media breakpoint: the companion drops below the stage
     automatically when the container can't hold both at their min widths. That's the fix
     for the A/B/C report (2026-07-12) — a fixed 900px grid breakpoint left a 900–1040px
     two-column band where the 360px companion squeezed the stage until the FIXED-width
     bidding box (~222px, can't shrink) overflowed its track and overlapped the South hand.
     Keyed on the stage min-width, two-column survives only while the stage keeps room for
     the box; otherwise it wraps to full width (as the ≤900px case already did correctly).
     The ~360px companion keeps the stage wide enough for the caps to grow the table when
     two-column DOES fit (the earlier "smaller fonts" fix). */
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  align-items: flex-start;
  justify-content: center;
}
.practice-grid-stage {
  /* Min width = room for status + hand + the fixed bidding box; below this the companion
     wraps rather than squeezing the box onto the hand. min(…,100%) still allows shrink on
     a genuinely tiny viewport (phone — not optimized; the box's narrow form is separate). */
  flex: 1 1 640px;
  min-width: min(640px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* NW corner: stack the board glyph over the (play/review) status, left-aligned. */
.practice-grid-layout .a1-grid-nw {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
/* Blue lesson-context ribbon in the companion (restored from DealInfo — same palette). */
.practice-grid-companion .grid-context-ribbon {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  background: #e3f2fd;
  border-left: 3px solid #1976d2;
  border-radius: 4px;
  text-align: left;
  font-size: 15px;
  line-height: 1.4;
  color: #0d3a66;
}
.practice-grid-companion .grid-context-ribbon-icon { color: #1976d2; font-weight: bold; flex-shrink: 0; }
/* Completed auction atop the companion (defence scenes) — natural size, capped so it
   doesn't stretch the full companion width; the companion's --table-scale is 1.0. */
.practice-grid-companion .a1-companion-auction { max-width: 300px; }
/* The grid scales the TABLE up (caps), so the companion prose is bumped to match —
   at base 15px it read small next to the enlarged hand/auction (2026-07-12 report).
   Senior-friendly; legacy (.practice-right) keeps 15px. */
.practice-grid-companion .commentary-text-container,
.practice-grid-companion .display-commentary {
  font-size: 17px;
  line-height: 1.55;
}
.practice-grid-companion {
  /* Basis 300 (was 340) so two-column survives at an iPad-portrait 12.9" (1024 device →
     992 content): flex-WRAP decides on the flex-basis SUM, not the min-widths, so
     stage 640 + companion 340 + gap 32 = 1012 > 992 was wrapping the companion below
     the stage → a too-tall single column (2026-07-13 iPad report). 640 + 300 + 32 = 972
     leaves a ~20px cushion, and the companion still grows past 300 on wider viewports. */
  flex: 1 1 300px;
  min-width: min(300px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: stretch;
}
/* Match the gallery's auction sizing (the caps/measurement work was verified against
   this max-width; the auction renders in its dense form here as in the gallery). */
.practice-grid-layout .a1-center-auction { max-width: 260px; }
.practice-grid-layout .a1-grid-ne {
  background: #f7f9f6;
  border: 1px solid #e6e8e3;
  border-radius: 10px;
  padding: 8px 10px;
}
@media (max-width: 900px) {
  /* Flex-wrap already stacks the companion; just tighten the gap on narrow screens. */
  .practice-grid-layout { gap: 20px; }
}

/* Collection view */
.collection-view {
  text-align: center;
  padding: 40px;
  background: #fff;
  border-radius: var(--radius-card, 8px);
}

.collection-view h2 {
  margin-bottom: 8px;
  color: var(--text-primary, #333);
}

.collection-subtitle {
  margin-bottom: 16px;
  color: var(--text-secondary, #666);
}

/* Legacy bidding-area - now integrated into practice-right */

.bidding-box-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.turn-indicator {
  font-size: 16px;
  font-weight: 500;
  color: #007bff;
}

.prompt-text {
  max-width: 400px;
  padding: 12px 16px;
  background: #e3f2fd;
  border-left: 4px solid #2196f3;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  text-align: left;
  white-space: pre-wrap;
}

.back-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  background: #e0e0e0;
  color: #333;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 8px;
}

.back-btn:hover {
  background: #d0d0d0;
}

.auction-complete {
  text-align: center;
  padding: 20px;
  background: #e8f5e9;
  border-radius: 8px;
  max-width: 500px;
}

.auction-complete h3 {
  color: #4caf50;
  margin-bottom: 12px;
}

.full-commentary {
  text-align: left;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  background: #fff;
  padding: 16px;
  border-radius: 4px;
  margin-bottom: 16px;
  white-space: pre-wrap;
}

.full-narrative {
  text-align: left;
  font-size: 14px;
  line-height: 1.6;
  background: #fff;
  padding: 16px;
  border-radius: 4px;
  margin-bottom: 16px;
  max-height: 350px;
  overflow-y: auto;
}

.completion-controls {
  display: flex;
  justify-content: center;
  gap: 12px;
  align-items: center;
}

.next-deal-btn {
  padding: 12px 24px;
  border: none;
  background: #4caf50;
  color: white;
  font-size: 16px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
}

.next-deal-btn:hover {
  background: #388e3c;
}

/* Bidding narrative styles - accumulating text */
.bidding-narrative-container {
  max-width: 500px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.bidding-narrative {
  max-height: 250px;
  overflow-y: auto;
  margin-bottom: 16px;
  padding-right: 8px;
  font-size: 15px;
  line-height: 1.6;
}

.narrative-text {
  display: block;
  white-space: pre-wrap;
  margin-bottom: 8px;
}

.narrative-text.previous {
  color: #999;
}

.narrative-text.current {
  color: #333;
}

/* Reframe note (#67): a meta-line before an accepted-alternative step's
   explanation, flagging that the following prose describes the RECORDED call,
   not the student's. Orange accent matches the "acceptable alternative" panel;
   declared after previous/current so it wins the color on a step that is both. */
.narrative-text.reframe-note {
  color: #ed6c02;
  font-style: italic;
  font-weight: 600;
  font-size: 0.9em;
  margin-bottom: 4px;
}

/* Brief affirmation shown on a correct bid (coaching-feedback-fade). */
.narrative-text.affirmation {
  color: #2e7d32;
  font-weight: 600;
}

/* Board-level cheer when every call was correct (coaching-feedback-fade). */
.narrative-text.celebration {
  color: #2e7d32;
  font-weight: 700;
  font-size: 1.25em;
  margin-top: 4px;
}

.bidding-box-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

/* Instruction mode styles */
.instruction-panel {
  max-width: 500px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.instruction-progress {
  font-size: 13px;
  color: #666;
  margin-bottom: 12px;
}

.instruction-text-container {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 20px;
  padding-right: 8px;
}

.instruction-text {
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
  margin-bottom: 12px;
}

.instruction-text.previous {
  color: #999;
  border-left: 2px solid #ddd;
  padding-left: 12px;
  margin-left: 4px;
}

.instruction-text.current {
  color: #333;
}

/* Suit symbol colors */
.suit-red {
  color: #d32f2f;
}

.suit-black {
  color: #000;
}

.instruction-controls {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.commentary-text-container {
  overflow-y: auto;
  padding-right: 6px;
}

.commentary-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  margin-top: 10px;
}

/* Left zone: bidding box / Back / Next, takes the remaining width. */
.controls-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.commentary-controls .bidding-box-wrapper,
.commentary-controls .card-choice-prompt {
  width: 100%;
}

.instruction-btn {
  padding: 10px 20px;
  font-size: 15px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.instruction-btn.primary {
  background: #2196f3;
  color: white;
}

.instruction-btn.primary:hover {
  background: #1976d2;
}

.instruction-btn.secondary {
  background: #e0e0e0;
  color: #333;
}

.instruction-btn.secondary:hover {
  background: #d0d0d0;
}

.card-choice-prompt {
  font-size: 15px;
  font-weight: 500;
  color: #1976d2;
  padding: 10px 20px;
  background: #e3f2fd;
  border-radius: 4px;
}

/* Report a Problem button — unobtrusive, sits below the lesson controls */
.report-problem-row {
  display: flex;
  justify-content: flex-end;
  width: 100%;
  margin-top: 4px;
}

.report-problem-btn {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 9px 16px;
  font-size: 15px;
  font-weight: 600;
  color: #888;
  background: none;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.2s;
}

.report-problem-btn:hover {
  background: #fdecea;
  color: #c62828;
}

/* Display mode styles */
.display-commentary {
  max-width: 500px;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  white-space: pre-wrap;
}

.load-another {
  text-align: center;
  margin-top: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.load-link {
  color: #666;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  background: none;
  border: none;
  padding: 0;
}

.load-link:hover {
  color: #007bff;
}

.separator {
  color: #ccc;
  font-size: 13px;
}

/* Tablet breakpoint - stack layout vertically */
@media (max-width: 900px) {
  .practice-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .practice-right {
    align-items: stretch;
  }
}

@media (max-width: 600px) {
  .app-header {
    flex-direction: column;
    gap: 8px;
  }

  .app-header h1 {
    font-size: 20px;
  }

  /* Stacked layout — the greeting sits on its own row, so the title can use the
     full width again. */
  .app-header.has-greeting h1 {
    max-width: none;
  }
}
</style>
