#include "chaos.h"

f32 originalScale;
void big_start(GraphicsContext* gfxCtx, GameState* gameState) {
    PlayState* play = (PlayState*)gameState;
    Player* player = GET_PLAYER(play);
    
    originalScale = player->actor.scale.y;

    Actor_SetScale(&player->actor, originalScale * 3);
    Player_PlaySfx(player, NA_SE_PL_TRANSFORM_GIANT);
}

void big_update() {}

void big_end(GraphicsContext* gfxCtx, GameState* gameState) {
    PlayState* play = (PlayState*)gameState;
    Player* player = GET_PLAYER(play);
    
    Actor_SetScale(&player->actor, originalScale);
}

ChaosEffect big = {
    .name = "Big",
    .duration = 20 * 20, // 20 seconds
    .on_start_fun = big_start,
    .update_fun = big_update,
    .on_end_fun = big_end
};

RECOMP_CALLBACK("mm_recomp_chaos_framework", chaos_on_init)
void register_big() {
    /*chaos_register_effect(&big, CHAOS_DISTURBANCE_VERY_LOW, NULL);
    chaos_register_effect(&big, CHAOS_DISTURBANCE_LOW, NULL);
    chaos_register_effect(&big, CHAOS_DISTURBANCE_MEDIUM, NULL);
    chaos_register_effect(&big, CHAOS_DISTURBANCE_HIGH, NULL);
    chaos_register_effect(&big, CHAOS_DISTURBANCE_VERY_HIGH, NULL);*/
}