import { useRef, useState, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations, Billboard } from "@react-three/drei";
import { Quaternion, Vector3, Vector3 as V3 } from "three";
import { RigidBody, CapsuleCollider } from "@react-three/rapier";
import { useQuest } from "./QuestContext";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GhostDissolveEffect } from "./GhostDissolveEffect";

const WALK_SPEED = 4;          // 行走速度 m/s
const ATTACK_RANGE = 1;        // 攻击距离 m
const SCALE = 1;           // 模型缩放
const ROT = [0, 0, 0];
const ATTACK_COOLDOWN = 1000;    // 毫秒
const MAX_HP = 10;

export default function GhostFollow({ playerRef, spawnPos = [0,0,0], onDead, raining = true }) {
  const { addKill } = useQuest();
  const { scene, animations } = useGLTF("models/ghost/scene.gltf");
  const ghostScene = useMemo(() => clone(scene), [scene]);
  const rigid = useRef();          // RigidBody 引用
  const model = useRef();          // 模型组引用
  const { actions } = useAnimations(animations, model);
  const [curr, setCurr] = useState("Idle");
  const [hp, setHp] = useState(MAX_HP);
  const [dead, setDead] = useState(false);
  const [vanishing, setVanishing] = useState(false);
  const vanishPosRef = useRef(new Vector3(...spawnPos));
  const lastAttack = useRef(0);

  // 播放动画并做去重
  const play = (name) => {
    if (curr === name || !actions[name]) return;
    Object.values(actions).forEach((a) => a.stop());
    actions[name].reset().fadeIn(0.2).play();
    setCurr(name);
  };

  // 挂载后，在刚体创建完毕的下一帧设置出生点
  useEffect(() => {
    if (rigid.current) {
      rigid.current.setTranslation(
        { x: spawnPos[0], y: spawnPos[1], z: spawnPos[2] },
        true
      );
    }
  }, [spawnPos]);

  const startVanish = () => {
    if (vanishing) return;
    setVanishing(true);
    // 记录当前世界坐标并禁用刚体，避免在物理步内移除
    if (rigid.current) {
      const t = rigid.current.translation();
      vanishPosRef.current.set(t.x, t.y, t.z);
      // 将幽魂刚体禁用，防止继续参与碰撞/积分
      rigid.current.setEnabled(false);
    }
    // 延迟完全卸载（移除 RigidBody）
    setTimeout(() => {
      setDead(true);
      if (onDead) onDead();
    }, 2200);
  };

  const handleHit = (damage = 10) => {
    setHp((prev) => {
      const next = prev - damage;
      if (next <= 0) {
        addKill();
        startVanish();
      }
      return next;
    });
  };

  // 当 hp <= 0 时组件会在下一帧直接卸载，因此无需显式调用 rigidBody.setEnabled(false)。
  // 过早或重复地释放刚体资源会导致 Rapier wasm 抛出 "expected instance" 等错误。

  useFrame((_, dt) => {
    if (dead) return;
    if (!playerRef.current || !rigid.current) return;

    // 玩家位置
    const p = playerRef.current.translation();
    const g = rigid.current.translation();

    const dist = Math.hypot(p.x - g.x, p.z - g.z);

    // 面向
    model.current?.lookAt(p.x, g.y, p.z);

    const now = performance.now();

    if (dist > ATTACK_RANGE) {
      // 追踪
      const dir = new V3(p.x - g.x, 0, p.z - g.z).normalize();
      const next = new V3(g.x + dir.x * WALK_SPEED * dt, g.y, g.z + dir.z * WALK_SPEED * dt);
      rigid.current.setNextKinematicTranslation(next);
      play("Armature|Action_Walk");
    } else {
      // 在攻击范围内
      play("Armature|Action_Atack");

      if (now - lastAttack.current > ATTACK_COOLDOWN) {
        lastAttack.current = now;
        // 轻微后撤 0.3m 以触发再次进入事件
        const backDir = new V3(g.x - p.x, 0, g.z - p.z).normalize();
        const retreat = new V3(g.x + backDir.x * 0.3, g.y, g.z + backDir.z * 0.3);
        rigid.current.setNextKinematicTranslation(retreat);
      }
    }
  });

  // 雨停时触发消散
  useEffect(() => {
    if (!raining) {
      startVanish();
    }
  }, [raining]);

  // 如果特效结束后则卸载
  if (dead) return null;

  return (
    <group>
      {/* 粒子特效层 */}
      {vanishing && <GhostDissolveEffect position={vanishPosRef.current} />}

      {/* 幽魂物理与模型层（vanishing 时保持但隐藏模型） */}
      <RigidBody
        ref={rigid}
        type="kinematicPosition"
        colliders={false}
        sensor
        userData={{ type: "enemy" }}
        onIntersectionEnter={({ other }) => {
          if (other.rigidBody.userData?.type === "magic") {
            const dmg = other.rigidBody.userData?.damage ?? 10;
            handleHit(dmg);
          }
        }}
      >
        {!vanishing && (
          <>
            {/* 血条 */}
            <Billboard position={[0, 2, 0]}>
              <mesh position-z={-0.01}>
                <planeGeometry args={[1, 0.12]} />
                <meshBasicMaterial color="black" transparent opacity={0.4} />
              </mesh>
              <mesh scale-x={hp / MAX_HP} position-x={-0.5 * (1 - hp / MAX_HP)}>
                <planeGeometry args={[1, 0.12]} />
                <meshBasicMaterial color="red" toneMapped={false} />
              </mesh>
            </Billboard>

            <group ref={model}>
              <primitive object={ghostScene} scale={SCALE} rotation={ROT} />
            </group>
          </>
        )}
        {/* 用于碰撞检测的胶囊 */}
        <CapsuleCollider args={[0.4, 0.6]} position={[0, 1, 0]} />
      </RigidBody>
    </group>
  );
}

useGLTF.preload("models/ghost/scene.gltf");
