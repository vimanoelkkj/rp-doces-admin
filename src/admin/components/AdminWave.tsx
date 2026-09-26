import { motion, useReducedMotion } from "motion/react";
import "./AdminWave.css";

const PRIMARY_A =
  "M0 0V324.8C120.0 433.1 253.3 460.1 400.0 406.0C546.7 351.9 680.0 340.3 800.0 371.2C920.0 402.1 1053.3 394.4 1200.0 348.0C1320.0 309.3 1400.0 270.7 1440 232.0V0H0Z";

const PRIMARY_B =
  "M0 0V332.8C134.0 421.1 271.0 448.1 416.0 396.0C562.0 362.9 697.0 354.3 817.0 383.2C938.0 391.1 1070.0 382.4 1214.0 340.0C1332.0 319.3 1410.0 280.7 1440 240.0V0H0Z";

const PRIMARY_C =
  "M0 0V318.8C108.0 438.1 238.0 466.1 386.0 413.0C532.0 342.9 664.0 329.3 784.0 360.2C904.0 412.1 1038.0 403.4 1186.0 355.0C1308.0 301.3 1390.0 262.7 1440 226.0V0H0Z";

const SECONDARY_A =
  "M0 0V335.8C132.0 445.1 268.0 469.1 412.0 395.0C536.0 339.9 668.0 351.3 788.0 384.2C934.0 413.1 1066.0 383.4 1188.0 335.0C1310.0 320.3 1392.0 283.7 1440 241.0V0H0Z";

const SECONDARY_B =
  "M0 0V329.8C118.0 437.1 252.0 461.1 398.0 403.0C550.0 347.9 684.0 360.3 804.0 392.2C918.0 404.1 1050.0 374.4 1202.0 328.0C1322.0 327.3 1402.0 290.7 1440 247.0V0H0Z";

const SECONDARY_C =
  "M0 0V341.8C146.0 451.1 282.0 475.1 426.0 388.0C522.0 332.9 654.0 343.3 774.0 376.2C948.0 421.1 1080.0 391.4 1174.0 341.0C1298.0 314.3 1382.0 276.7 1440 236.0V0H0Z";

export default function AdminWave() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="admin-wave" aria-hidden="true">
      <svg
        viewBox="0 0 1440 434"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <motion.path
          className="wave-secondary"
          d={SECONDARY_A}
          initial={{ d: SECONDARY_A }}
          animate={
            shouldReduceMotion
              ? undefined
              : { d: [SECONDARY_A, SECONDARY_B, SECONDARY_C] }
          }
          transition={
            shouldReduceMotion
              ? undefined
              : {
                  duration: 12,
                  repeat: Infinity,
                  repeatType: "mirror",
                  ease: "easeInOut",
                }
          }
        />
        <motion.path
          className="wave-primary"
          d={PRIMARY_A}
          initial={{ d: PRIMARY_A }}
          animate={
            shouldReduceMotion
              ? undefined
              : { d: [PRIMARY_A, PRIMARY_B, PRIMARY_C] }
          }
          transition={
            shouldReduceMotion
              ? undefined
              : {
                  duration: 9,
                  repeat: Infinity,
                  repeatType: "mirror",
                  ease: "easeInOut",
                }
          }
        />
      </svg>
    </div>
  );
}
