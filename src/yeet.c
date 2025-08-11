#include "chaos.h"

void Yeet_Start(GraphicsContext* gfxCtx, GameState* gameState) {
    PlayState* play = (PlayState*)gameState;

    Player* player = GET_PLAYER(play);
    Player_PlaySfx(player, NA_SE_EV_EXPLOSION);
}

bool lastFrameHeld = false;

Actor* heldItem;
bool isExplosive = false;

void Yeet_Update(GraphicsContext* gfxCtx, GameState* gameState) {
    PlayState* play = (PlayState*)gameState;
    Player* player = GET_PLAYER(play);

    bool currentlyHeld = player->stateFlags1 & PLAYER_STATE1_CARRYING_ACTOR;

    if (!lastFrameHeld && currentlyHeld) {
        heldItem = player->heldActor;
        isExplosive = Player_GetExplosiveHeld(player) != PLAYER_EXPLOSIVE_NONE;
    }

    else if (lastFrameHeld && !currentlyHeld) {
        if (isExplosive) {
            Player_PlaySfx(player, NA_SE_EN_STAL01_LAUGH);
            heldItem->gravity *= 0.7f;
            heldItem->speed *= 4;
        }
    }

    lastFrameHeld = currentlyHeld;
}

void Yeet_End(GraphicsContext* gfxCtx, GameState* gameState) {
    PlayState* play = (PlayState*)gameState;
}

ChaosEffect yeet = {
    .name = "YEET",
    .duration = 20 * 30, // 30 seconds
    .on_start_fun = Yeet_Start,
    .update_fun = Yeet_Update,
    .on_end_fun = Yeet_End
};

RECOMP_CALLBACK("mm_recomp_chaos_framework", chaos_on_init)
void register_yeet() {
    chaos_register_effect(&yeet, CHAOS_DISTURBANCE_VERY_LOW, NULL);
    chaos_register_effect(&yeet, CHAOS_DISTURBANCE_LOW, NULL);
    chaos_register_effect(&yeet, CHAOS_DISTURBANCE_MEDIUM, NULL);
    chaos_register_effect(&yeet, CHAOS_DISTURBANCE_HIGH, NULL);
    chaos_register_effect(&yeet, CHAOS_DISTURBANCE_VERY_HIGH, NULL);
}