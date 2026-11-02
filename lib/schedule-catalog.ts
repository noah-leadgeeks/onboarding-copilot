import type { Activity, ActivityStatus } from '@/lib/types/activity';

/**
 * Official master schedule activities from worksheet 'Schedule' (Rows 3–70)
 * in the HR onboarding workbook.
 */

export type ScheduleProgress = 'Done' | 'In Progress' | 'On-Hold' | 'Reschedule' | '';

export interface ScheduleActivity {
  readonly id: string;
  readonly rowNumber: number; // Row number in sheet 'Schedule' (e.g. 3, 4, 20...)
  readonly week: string; // 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Month 1 Review', etc.
  readonly day: string; // 'Tuesday', 'Wednesday', etc.
  readonly date: string; // DD/MM/YYYY
  readonly activityCount?: number; // 1, 2, 3...
  readonly pic: string; // HRD, CEO, MD, IT Manager, IT Staff, Experience...
  readonly topic: string;
  readonly mainMedia: string; // Online Meeting, Video, Knowledge Sharing...
  readonly durationMinutes?: number; // Column G
  readonly startTime?: string; // Column H (HH:MM)
  readonly endTime?: string; // Column I (HH:MM)
  readonly progress: ScheduleProgress | string; // Column J: 'Done' | 'In Progress' | 'On-Hold' | 'Reschedule' | ''
  readonly materialsLink?: string; // Column K: Link to the Materials or Recording
  readonly notes?: string; // Column L: Notes
}

export const SCHEDULE_CUSTOMIZATIONS_STORAGE_KEY = 'nova-schedule-customizations';

export const OFFICIAL_SCHEDULE_ACTIVITIES: readonly ScheduleActivity[] = [
  {
    "id": "sched-row-3",
    "rowNumber": 3,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 1,
    "pic": "HRD",
    "topic": "Introduction to Onboarding Framework",
    "mainMedia": "Online Meeting",
    "durationMinutes": 30,
    "startTime": "08:30",
    "endTime": "09:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/xbCm2pWUee9PyF14kcaJC2h_Fow9DhfJ"
  },
  {
    "id": "sched-row-4",
    "rowNumber": 4,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 2,
    "pic": "CEO",
    "topic": "Welcoming Message from Chief Executive Officer (CEO)",
    "mainMedia": "Video",
    "durationMinutes": 3,
    "startTime": "09:15",
    "endTime": "09:18",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/h_x_eE38WAMnyMY4-vmrlHfVMXtCXGNT"
  },
  {
    "id": "sched-row-5",
    "rowNumber": 5,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 3,
    "pic": "Managing Director",
    "topic": "Welcoming Message from Managing Directors (MD)",
    "mainMedia": "Video",
    "durationMinutes": 3,
    "startTime": "09:19",
    "endTime": "09:22",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/1g706J0_49ya8Q4MEf9viu3WMxHgkneA"
  },
  {
    "id": "sched-row-6",
    "rowNumber": 6,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 4,
    "pic": "Managing Director",
    "topic": "Introduction to LeadGeeks",
    "mainMedia": "Video",
    "durationMinutes": 30,
    "startTime": "09:23",
    "endTime": "09:53",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/2DcfN8RVSaAlRXLsu-vSI2I2pdS2S8t_"
  },
  {
    "id": "sched-row-7",
    "rowNumber": 7,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 5,
    "pic": "HRD",
    "topic": "Introduction to Human Resources Department",
    "mainMedia": "Video",
    "durationMinutes": 20,
    "startTime": "10:00",
    "endTime": "10:20",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/0aOv74MkBVD6qiYqc9XN7WBP7EjtlLjZ"
  },
  {
    "id": "sched-row-8",
    "rowNumber": 8,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 6,
    "pic": "HRD",
    "topic": "Company Policies & Employee Guidelines",
    "mainMedia": "Video",
    "durationMinutes": 60,
    "startTime": "10:30",
    "endTime": "11:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/NdrHDZ-xD-o_FtwvY9lBrjmfdLmC2Sb1"
  },
  {
    "id": "sched-row-9",
    "rowNumber": 9,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 7,
    "pic": "HRD",
    "topic": "Personnel Administration",
    "mainMedia": "Video",
    "durationMinutes": 40,
    "startTime": "13:00",
    "endTime": "13:40",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/FkQ7gvMDTrpRYD-pW7jA-qgHdDYA20ZQ"
  },
  {
    "id": "sched-row-10",
    "rowNumber": 10,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 8,
    "pic": "Experience",
    "topic": "Welcoming Event from All Staff",
    "mainMedia": "Online Meeting",
    "durationMinutes": 20,
    "startTime": "12:30",
    "endTime": "12:50",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/ej3rUeN_SYL9Tw2PKs1ghuAuQA-7eiLm"
  },
  {
    "id": "sched-row-11",
    "rowNumber": 11,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 9,
    "pic": "Managing Director",
    "topic": "Team Introduction",
    "mainMedia": "Online Meeting",
    "durationMinutes": 20,
    "startTime": "12:50",
    "endTime": "13:10",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/iC4iNEPF3SQghLhe9Hw0RI48m798jfgX"
  },
  {
    "id": "sched-row-12",
    "rowNumber": 12,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 10,
    "pic": "Managing Director & EA",
    "topic": "Introduction to Management Office Department",
    "mainMedia": "Video",
    "durationMinutes": 40,
    "startTime": "19:30",
    "endTime": "20:10",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/-noLau4R9rHikYOAXl7-xq43rLRJnXhg"
  },
  {
    "id": "sched-row-13",
    "rowNumber": 13,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 11,
    "pic": "Experience Manager",
    "topic": "Experience Department Introduction",
    "mainMedia": "Online Meeting",
    "durationMinutes": 90,
    "startTime": "15:00",
    "endTime": "16:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/3JL8ue96aZKFtd97mbCEjVQQh3_A-z63"
  },
  {
    "id": "sched-row-14",
    "rowNumber": 14,
    "week": "Week 1",
    "day": "Tuesday",
    "date": "01/09/2026",
    "activityCount": 12,
    "pic": "HRD Staff",
    "topic": "Filling Time and Task Tracking (Practice)",
    "mainMedia": "Personal Task",
    "durationMinutes": 40,
    "startTime": "16:30",
    "endTime": "17:10",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/eTJ27w3u6RHXZ0cKOYQ5IPAk7EIA-xzf"
  },
  {
    "id": "sched-row-15",
    "rowNumber": 15,
    "week": "Week 1",
    "day": "Wednesday",
    "date": "02/09/2026",
    "activityCount": 13,
    "pic": "IT Manager",
    "topic": "Introduction to the IT Department\n- Structure & Scope\n- Culture & Collaboration\n- Communication Channels\n- IT Department Tools",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 125,
    "startTime": "09:00",
    "endTime": "11:05",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/utpaM50XPvBszFXLxfBXlWYpgOgl8ZlW"
  },
  {
    "id": "sched-row-16",
    "rowNumber": 16,
    "week": "Week 1",
    "day": "Wednesday",
    "date": "02/09/2026",
    "activityCount": 14,
    "pic": "IT Staff",
    "topic": "Independent Learning\n- Setting up personal IT environment (Hardware, Workspace, and other basic equipment needed)\n- Explore and install common applications and platforms across department used at LeadGeeks\n- Explore and set up accounts across platforms used in IT Department",
    "mainMedia": "Personal Learning",
    "durationMinutes": 210,
    "startTime": "13:30",
    "endTime": "17:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/NF4SMkJbCqtut5M8VJhNPfwBv0ZhF-rI"
  },
  {
    "id": "sched-row-17",
    "rowNumber": 17,
    "week": "Week 1",
    "day": "Wednesday",
    "date": "02/09/2026",
    "activityCount": 15,
    "pic": "Growth Manager",
    "topic": "Growth Department Introduction",
    "mainMedia": "Online Meeting",
    "durationMinutes": 25,
    "startTime": "11:05",
    "endTime": "11:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/8zDBwvT_4Y-92lZrTvBL8MAX3o4xFJWc"
  },
  {
    "id": "sched-row-18",
    "rowNumber": 18,
    "week": "Week 1",
    "day": "Wednesday",
    "date": "02/09/2026",
    "activityCount": 16,
    "pic": "Operations Manager",
    "topic": "Operations Department Introduction",
    "mainMedia": "Online Meeting",
    "durationMinutes": 30,
    "startTime": "11:30",
    "endTime": "12:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/CDnlswoG3K2mcThfRpEAPZsbnmU1ReBW"
  },
  {
    "id": "sched-row-19",
    "rowNumber": 19,
    "week": "Week 1",
    "day": "Wednesday",
    "date": "02/09/2026",
    "activityCount": 17,
    "pic": "EA & Tax Staff",
    "topic": "Introduction to Finance & Accounting Department",
    "mainMedia": "Online Meeting",
    "durationMinutes": 30,
    "startTime": "14:00",
    "endTime": "14:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/0NEG5FiHxuf68BDdnWTv-SWKGc8NANoG"
  },
  {
    "id": "sched-row-20",
    "rowNumber": 20,
    "week": "Week 1",
    "day": "Thursday",
    "date": "03/09/2026",
    "activityCount": 18,
    "pic": "IT Manager",
    "topic": "How IT Works at LeadGeeks\n- IT Workflow & Request Handling\n- Incident Handling & Escalation\n- Documentation & Knowledge Management\n- Cross-Department Collaboration\n- IT SOPs and Best Practices\n- Basic Cybersecurity & Access Management Practices\n- Business Impact of IT Tasks",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 155,
    "startTime": "10:00",
    "endTime": "12:35",
    "progress": "Done",
    "materialsLink": "https://drive.google.com/drive/folders/1vqgl2skPDySh-IEBajNKyRVXkOh2RQrH?usp=sharing",
    "notes": "https://notes.noahisme.web.id/share/UsRp8VSkh5KodRY4TsRxqV29FZ5A6Drv"
  },
  {
    "id": "sched-row-21",
    "rowNumber": 21,
    "week": "Week 1",
    "day": "Thursday",
    "date": "03/09/2026",
    "activityCount": 19,
    "pic": "IT Staff",
    "topic": "Independent Learning\n- Learn and apply the Identify-Understand-Evaluate-Decide-Implement (I-U-E-D-I) approach.",
    "mainMedia": "Personal Learning",
    "durationMinutes": 325,
    "startTime": "14:05",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "https://drive.google.com/drive/folders/1H3Far06NyOVsLKn_0v1_1ko044n6QUGF?usp=sharing",
    "notes": "https://notes.noahisme.web.id/share/nSUFeRZJY-la36joMGRMxeXBFSKMCWz6"
  },
  {
    "id": "sched-row-22",
    "rowNumber": 22,
    "week": "Week 1",
    "day": "Friday",
    "date": "04/09/2026",
    "activityCount": 20,
    "pic": "IT Manager",
    "topic": "Understanding the Current IT Ecosystem\n- Ecosystem Overview & Architecture\n- Cross-Departmental Systems & Integration\n- Tool & Platform Deep Dive\n- Infrastructure & Access Setup",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 175,
    "startTime": "08:30",
    "endTime": "11:25",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/rkaAZbAlbIwK6A2sJ39mlVre84FfaZDR"
  },
  {
    "id": "sched-row-23",
    "rowNumber": 23,
    "week": "Week 1",
    "day": "Friday",
    "date": "04/09/2026",
    "activityCount": 21,
    "pic": "IT Staff",
    "topic": "Independent Learning\n- Review list of tools, platforms, and IT environments currently used at LeadGeeks.\n- Map which tools are used by which department, and how they relate to the IT Department.",
    "mainMedia": "Personal Learning",
    "durationMinutes": 165,
    "startTime": "13:35",
    "endTime": "16:20",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/YXjmCAbvrzpWtDR8fDEv9Ih5lV6OzkCo"
  },
  {
    "id": "sched-row-25",
    "rowNumber": 25,
    "week": "Week 2",
    "day": "Monday",
    "date": "07/09/2026",
    "activityCount": 22,
    "pic": "IT Manager",
    "topic": "Understanding LeadGeeks IT Department Functions\n- IT Department Functions\n- Main Systems & Tools per Function\n- Cross-Department Dependencies\n- Documentation & Tracking Methods",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 105,
    "startTime": "10:00",
    "endTime": "11:45",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/Fo-udjXS1z99fDnBE3POEqp9rLsbNl0O"
  },
  {
    "id": "sched-row-26",
    "rowNumber": 26,
    "week": "Week 2",
    "day": "Monday",
    "date": "07/09/2026",
    "activityCount": 23,
    "pic": "IT Staff",
    "topic": "Independent Learning and Task\n- Identify and map each IT function, its responsibilities, main systems/tools, and dependencies.",
    "mainMedia": "Personal Learning and Task",
    "durationMinutes": 240,
    "startTime": "14:00",
    "endTime": "18:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/Fo-udjXS1z99fDnBE3POEqp9rLsbNl0O"
  },
  {
    "id": "sched-row-27",
    "rowNumber": 27,
    "week": "Week 2",
    "day": "Tuesday",
    "date": "08/09/2026",
    "activityCount": 24,
    "pic": "IT Manager",
    "topic": "Infrastructure Management at LeadGeeks\n- Hardware & Device Management\n- Account & Access Management\n- Network, Server, & Hosting\n- IT Inventory & Asset Tracking",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 120,
    "startTime": "08:00",
    "endTime": "10:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/EXBtYk3k4jR4SaSfVDxt4eGv7eawHNns"
  },
  {
    "id": "sched-row-28",
    "rowNumber": 28,
    "week": "Week 2",
    "day": "Tuesday",
    "date": "08/09/2026",
    "activityCount": 25,
    "pic": "IT Staff",
    "topic": "Independent Learning and Task\n- Create a simple web app dashboard for tracking employee accounts and company devices.",
    "mainMedia": "Personal Learning and Task",
    "durationMinutes": 360,
    "startTime": "10:00",
    "endTime": "18:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/z1BvurfE5SvQSalecatZeXEBmvw-gNxX"
  },
  {
    "id": "sched-row-29",
    "rowNumber": 29,
    "week": "Week 2",
    "day": "Wednesday",
    "date": "09/09/2026",
    "activityCount": 26,
    "pic": "IT Manager",
    "topic": "Technology Optimization & Innovation at LeadGeeks\n- AI & Automation\n- Google Apps Script & Workflow Automation\n- System Development & Process Improvement\n- Existing Initiatives & Future Direction",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 145,
    "startTime": "10:00",
    "endTime": "12:25",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/TzggJKHv_Ss-SkXI6jxdHumVlfeeblEL"
  },
  {
    "id": "sched-row-30",
    "rowNumber": 30,
    "week": "Week 2",
    "day": "Wednesday",
    "date": "09/09/2026",
    "activityCount": 27,
    "pic": "IT Staff",
    "topic": "Independent Learning and Task\n- Create a simple web app to optimize and automate workflows/processes for time and task tracking.",
    "mainMedia": "Personal Learning and Task",
    "durationMinutes": 335,
    "startTime": "13:00",
    "endTime": "18:35",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/6RypoLjJnbSPSXHoi7TLJTgCyDzZ7K7R"
  },
  {
    "id": "sched-row-31",
    "rowNumber": 31,
    "week": "Week 2",
    "day": "Thursday",
    "date": "10/09/2026",
    "activityCount": 28,
    "pic": "IT Manager",
    "topic": "Cybersecurity at LeadGeeks\n- Current Security Practices\n- Data Protection & GDPR\n- Security Risks & Priorities\n- Security Assessment & Basic Response",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 120,
    "startTime": "13:00",
    "endTime": "15:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/ewhJ0s78SB7EJAdT8e2Ph2yOwpht62Pg"
  },
  {
    "id": "sched-row-32",
    "rowNumber": 32,
    "week": "Week 2",
    "day": "Thursday",
    "date": "10/09/2026",
    "activityCount": 29,
    "pic": "IT Staff",
    "topic": "Independent Learning and Task\n- Review security recommendation tools and identify potential security tools for implementation this year.",
    "mainMedia": "Personal Learning and Task",
    "durationMinutes": 270,
    "startTime": "10:30",
    "endTime": "18:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/AhqRnT8WPnWO1tzcs-msiVRdQJSbFpOU"
  },
  {
    "id": "sched-row-33",
    "rowNumber": 33,
    "week": "Week 2",
    "day": "Friday",
    "date": "11/09/2026",
    "activityCount": 30,
    "pic": "IT Manager",
    "topic": "Website Management at LeadGeeks\n- Website Ecosystem & Dependencies\n- CMS / WordPress\n- Website Structure & Content Management\n- Technical SEO & Digital Presence",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 145,
    "startTime": "09:00",
    "endTime": "11:25",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/V5XKY-VmJhiF73Ub98frOjFAWyS4Nlu7"
  },
  {
    "id": "sched-row-34",
    "rowNumber": 34,
    "week": "Week 2",
    "day": "Friday",
    "date": "11/09/2026",
    "activityCount": 31,
    "pic": "IT Staff",
    "topic": "Independent Learning and Task\n- Identify and explore processes and features in the website CMS (Wordpress) that can be optimized using AI.",
    "mainMedia": "Personal Learning and Task",
    "durationMinutes": 335,
    "startTime": "08:00",
    "endTime": "17:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/-3rCs3lTFwGa8BCaJ9jlZ5_X9H9lRm2J"
  },
  {
    "id": "sched-row-36",
    "rowNumber": 36,
    "week": "Week 3",
    "day": "Monday",
    "date": "14/09/2026",
    "activityCount": 32,
    "pic": "IT Staff",
    "topic": "Contact and conduct meetings with 3 relevant other department members (Operations and Growth) to understand Lead Generation processes and AI Optimization efforts in 2025 and 2026",
    "mainMedia": "Personal Task",
    "durationMinutes": 130,
    "startTime": "14:00",
    "endTime": "16:40",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/EBHoGZvK6LgmxI8Ko3ITz4HeQJIa5h7G"
  },
  {
    "id": "sched-row-37",
    "rowNumber": 37,
    "week": "Week 3",
    "day": "Tuesday",
    "date": "15/09/2026",
    "activityCount": 33,
    "pic": "IT Staff",
    "topic": "Observe the processes and identify potential opportunities for AI optimization, then develop solution proposals for discussion in the Technology Optimization meeting",
    "mainMedia": "Personal Task",
    "durationMinutes": 305,
    "startTime": "13:00",
    "endTime": "18:05",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/A_RRC6Bl_a9pyV0VMtQ0Ubnlk_fSXjAw"
  },
  {
    "id": "sched-row-38",
    "rowNumber": 38,
    "week": "Week 3",
    "day": "Wednesday",
    "date": "16/09/2026",
    "activityCount": 33,
    "pic": "IT Staff",
    "topic": "Prepare the presentation for proposed technology optimization using AI",
    "mainMedia": "Personal Task",
    "durationMinutes": 135,
    "startTime": "10:00",
    "endTime": "14:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/jY5z7bQ_cwQZRS40xTI_JIJQcbgV6Gmy"
  },
  {
    "id": "sched-row-39",
    "rowNumber": 39,
    "week": "Week 3",
    "day": "Thursday",
    "date": "17/09/2026",
    "activityCount": 34,
    "pic": "IT Staff",
    "topic": "Identify and explore proposed solutions for the optimization and automation of the AI Email Template Creation process",
    "mainMedia": "Personal Task",
    "durationMinutes": 290,
    "startTime": "12:30",
    "endTime": "19:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/l0iFF2qXCFUV7tFFxYYhRddNAZIKfTOB"
  },
  {
    "id": "sched-row-40",
    "rowNumber": 40,
    "week": "Week 3",
    "day": "Thursday",
    "date": "17/09/2026",
    "activityCount": 35,
    "pic": "IT Staff",
    "topic": "Explore Beanstalk application to check the functionality",
    "mainMedia": "Personal Task",
    "durationMinutes": 95,
    "startTime": "17:00",
    "endTime": "18:35",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/Li_dNuTIVYdUT13u4S0w4ub6wV8A784W"
  },
  {
    "id": "sched-row-41",
    "rowNumber": 41,
    "week": "Week 3",
    "day": "Friday",
    "date": "18/09/2026",
    "activityCount": 36,
    "pic": "IT Manager",
    "topic": "Introduction to IT Department 2026 SMART Goals and Understanding How IT Support LeadGeeks Business Objectives",
    "mainMedia": "Knowledge Sharing & Discussion",
    "durationMinutes": 145,
    "startTime": "09:00",
    "endTime": "11:25",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/gurGlQA0mWyE42UhF6f4lOzdARtbyb8Q"
  },
  {
    "id": "sched-row-42",
    "rowNumber": 42,
    "week": "Week 3",
    "day": "Friday",
    "date": "18/09/2026",
    "activityCount": 37,
    "pic": "IT Staff",
    "topic": "Independent Learning\n- Read all SMART goals in IT Department including the current progress and next action items.",
    "mainMedia": "Personal Learning",
    "durationMinutes": 240,
    "startTime": "13:00",
    "endTime": "17:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/Ch2s8ayogSqOwF_a3vmlNALbihgnqF_Z"
  },
  {
    "id": "sched-row-44",
    "rowNumber": 44,
    "week": "Week 4",
    "day": "Monday",
    "date": "21/09/2026",
    "activityCount": 38,
    "pic": "Managing Director",
    "topic": "Beyond the Slides: Chat with the Managing Director",
    "mainMedia": "Offline",
    "durationMinutes": 60,
    "startTime": "11:30",
    "endTime": "12:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/iYCeTToWf0y66vtOpcyf2WznmHlxMqXS"
  },
  {
    "id": "sched-row-45",
    "rowNumber": 45,
    "week": "Week 4",
    "day": "Monday",
    "date": "21/09/2026",
    "activityCount": 39,
    "pic": "Experience Manager",
    "topic": "Business English Training",
    "mainMedia": "Online",
    "durationMinutes": 105,
    "startTime": "10:30",
    "endTime": "15:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/pyfMFHiocri8otnRyBvGaWg7h5FYJK-3"
  },
  {
    "id": "sched-row-46",
    "rowNumber": 46,
    "week": "Week 4",
    "day": "Tuesday",
    "date": "22/09/2026",
    "activityCount": 40,
    "pic": "IT Staff",
    "topic": "Develop and make the NOVA Onboarding, TETRA Time and Task Tracking, CORE IT Dashboard, and SMART Goals dashboard web app accessible to the public, including a clone database",
    "mainMedia": "Personal Task",
    "durationMinutes": 90,
    "startTime": "11:00",
    "endTime": "12:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/iJ93xyqZ4Ra0H8ZQvIaUzSAtncXtsPIt"
  },
  {
    "id": "sched-row-47",
    "rowNumber": 47,
    "week": "Week 4",
    "day": "Tuesday",
    "date": "22/09/2026",
    "activityCount": 41,
    "pic": "IT Staff",
    "topic": "Integrate the web apps with Google authentication and spreadsheet synchronization",
    "mainMedia": "Personal Task",
    "durationMinutes": 145,
    "startTime": "15:05",
    "endTime": "17:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/KxdTwijx2HYConvxg5uzIszGsKUY4nwS"
  },
  {
    "id": "sched-row-48",
    "rowNumber": 48,
    "week": "Week 4",
    "day": "Wednesday",
    "date": "23/09/2026",
    "activityCount": 42,
    "pic": "IT Staff",
    "topic": "Develop a solution for creating and quality-checking email templates using ChatGPT, based on custom instructions and agent guidance",
    "mainMedia": "Personal Task",
    "durationMinutes": 240,
    "startTime": "09:00",
    "endTime": "14:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-49",
    "rowNumber": 49,
    "week": "Week 4",
    "day": "Wednesday",
    "date": "23/09/2026",
    "activityCount": 43,
    "pic": "IT Staff",
    "topic": "Explore other solutions including workflow automation and ChatGPT alternatives that do not require a subscription, for email template creation and quality checking",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "15:00",
    "endTime": "18:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/2BCOlC9-ra4Mq6iKmNwo0eW0BWEX6JHF"
  },
  {
    "id": "sched-row-50",
    "rowNumber": 50,
    "week": "Week 4",
    "day": "Thursday",
    "date": "24/09/2026",
    "activityCount": 44,
    "pic": "IT Staff",
    "topic": "Explore ways to connect the spreadsheet with ChatGPT for email template creation and quality checking",
    "mainMedia": "Personal Task",
    "durationMinutes": 300,
    "startTime": "09:00",
    "endTime": "16:00",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/IxCClKikwwnCP6QZ1FuuxAl5wc-MG7vw"
  },
  {
    "id": "sched-row-51",
    "rowNumber": 51,
    "week": "Week 4",
    "day": "Friday",
    "date": "25/09/2026",
    "activityCount": 45,
    "pic": "IT Staff",
    "topic": "Adjust the layout and design of the NOVA Onboarding, TETRA Time and Task Tracking, CORE IT Dashboard, and SMART Goals Dashboard web apps",
    "mainMedia": "Personal Task",
    "durationMinutes": 270,
    "startTime": "15:00",
    "endTime": "19:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/H3UuWFpqJeyCJqU4hlzkuaKJSD-Jh1gJ"
  },
  {
    "id": "sched-row-53",
    "rowNumber": 53,
    "week": "Week 5",
    "day": "Monday",
    "date": "28/09/2026",
    "activityCount": 46,
    "pic": "Experience Manager",
    "topic": "Business English Training",
    "mainMedia": "Online",
    "durationMinutes": 75,
    "startTime": "14:30",
    "endTime": "15:45",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/UDagugqPpSAIBwkOXB3M8HF8FhRAFUj5"
  },
  {
    "id": "sched-row-54",
    "rowNumber": 54,
    "week": "Week 5",
    "day": "Monday",
    "date": "28/09/2026",
    "activityCount": 47,
    "pic": "IT Staff",
    "topic": "Explore AI Agent to support the automation process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "11:30",
    "endTime": "14:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/yoeH3wk5J9piNNzO3jpH0nVVafS990wi"
  },
  {
    "id": "sched-row-55",
    "rowNumber": 55,
    "week": "Week 5",
    "day": "Tuesday",
    "date": "29/09/2026",
    "activityCount": 48,
    "pic": "IT Staff",
    "topic": "Develop an automation process to connect the spreadsheet with ChatGPT for email template creation and quality checking",
    "mainMedia": "Personal Task",
    "durationMinutes": 305,
    "startTime": "16:00",
    "endTime": "21:05",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/qFABQQSOXGpCiN7A4qaDRKQ8inTVlotI"
  },
  {
    "id": "sched-row-56",
    "rowNumber": 56,
    "week": "Week 5",
    "day": "Wednesday",
    "date": "30/09/2026",
    "activityCount": 49,
    "pic": "IT Staff",
    "topic": "Revise and develop an automation process for email template creation and quality checking using ChatGPT",
    "mainMedia": "Personal Task",
    "durationMinutes": 120,
    "startTime": "15:30",
    "endTime": "17:30",
    "progress": "Done",
    "notes": "https://notes.noahisme.web.id/share/6ZJax8eTKqaItkQekznPCmOxVaImpERE"
  },
  {
    "id": "sched-row-58",
    "rowNumber": 58,
    "week": "Month 1 Review",
    "day": "Thursday",
    "date": "01/10/2026",
    "pic": "IT & HRD & MD",
    "topic": "Month 1 Performance Review & Feedback and Month 2 Expectations",
    "mainMedia": "Monthly Review",
    "durationMinutes": 60,
    "startTime": "09:00",
    "endTime": "10:00",
    "progress": "Done",
    "notes": "First Month Review"
  },
  {
    "id": "sched-row-59",
    "rowNumber": 59,
    "week": "Week 6",
    "day": "Thursday",
    "date": "01/10/2026",
    "activityCount": 50,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue the trial and improve the existing process based on the previous results",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "14:00",
    "endTime": "17:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-60",
    "rowNumber": 60,
    "week": "Week 6",
    "day": "Friday",
    "date": "02/10/2026",
    "activityCount": 51,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue the trial and improve the existing process based on the previous results",
    "mainMedia": "Personal Task",
    "durationMinutes": 60,
    "startTime": "14:20",
    "endTime": "15:20",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-61",
    "rowNumber": 61,
    "week": "Week 7",
    "day": "Monday",
    "date": "05/10/2026",
    "activityCount": 52,
    "pic": "Experience Manager",
    "topic": "Business English Training",
    "mainMedia": "Online",
    "durationMinutes": 70,
    "startTime": "10:30",
    "endTime": "11:40",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/pyfMFHiocri8otnRyBvGaWg7h5FYJK-3"
  },
  {
    "id": "sched-row-62",
    "rowNumber": 62,
    "week": "Week 7",
    "day": "Monday",
    "date": "05/10/2026",
    "activityCount": 53,
    "pic": "IT Staff",
    "topic": "Device Checking Process\n- Develop the web app for Device Checking process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "11:40",
    "endTime": "15:40",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/BcPHVtj6dOdCpJwG1BhAhR3XUkd76nGp"
  },
  {
    "id": "sched-row-63",
    "rowNumber": 63,
    "week": "Week 7",
    "day": "Monday",
    "date": "05/10/2026",
    "activityCount": 54,
    "pic": "IT Staff",
    "topic": "IT Ticketing Process\n- Develop the web app for IT Ticketing process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "15:40",
    "endTime": "18:40",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/vmqQStVl5cnObeJQkSnYMXGnA8BTsSit"
  },
  {
    "id": "sched-row-64",
    "rowNumber": 64,
    "week": "Week 7",
    "day": "Tuesday",
    "date": "06/10/2026",
    "activityCount": 55,
    "pic": "IT Staff",
    "topic": "Device Checking Process\n- Develop the web app for Device Checking process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "09:00",
    "endTime": "12:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/BcPHVtj6dOdCpJwG1BhAhR3XUkd76nGp"
  },
  {
    "id": "sched-row-65",
    "rowNumber": 65,
    "week": "Week 7",
    "day": "Tuesday",
    "date": "06/10/2026",
    "activityCount": 56,
    "pic": "IT Staff",
    "topic": "IT Ticketing Process\n- Develop the web app for IT Ticketing process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "14:00",
    "endTime": "17:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/vmqQStVl5cnObeJQkSnYMXGnA8BTsSit"
  },
  {
    "id": "sched-row-66",
    "rowNumber": 66,
    "week": "Week 7",
    "day": "Wednesday",
    "date": "07/10/2026",
    "activityCount": 57,
    "pic": "IT Staff",
    "topic": "Device Checking Process\n- Develop the web app for Device Checking process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "09:00",
    "endTime": "12:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/BcPHVtj6dOdCpJwG1BhAhR3XUkd76nGp"
  },
  {
    "id": "sched-row-67",
    "rowNumber": 67,
    "week": "Week 7",
    "day": "Wednesday",
    "date": "07/10/2026",
    "activityCount": 58,
    "pic": "IT Staff",
    "topic": "IT Ticketing Process\n- Develop the web app for IT Ticketing process",
    "mainMedia": "Personal Task",
    "durationMinutes": 180,
    "startTime": "14:00",
    "endTime": "17:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/vmqQStVl5cnObeJQkSnYMXGnA8BTsSit"
  },
  {
    "id": "sched-row-68",
    "rowNumber": 68,
    "week": "Week 7",
    "day": "Thursday",
    "date": "08/10/2026",
    "activityCount": 59,
    "pic": "IT Staff",
    "topic": "Device Checking Process\n- Develop the web app for Device Checking process",
    "mainMedia": "Personal Task",
    "durationMinutes": 190,
    "startTime": "10:10",
    "endTime": "14:20",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/BcPHVtj6dOdCpJwG1BhAhR3XUkd76nGp"
  },
  {
    "id": "sched-row-69",
    "rowNumber": 69,
    "week": "Week 7",
    "day": "Thursday",
    "date": "08/10/2026",
    "activityCount": 60,
    "pic": "IT Staff",
    "topic": "IT Ticketing Process\n- Develop the web app for IT Ticketing process",
    "mainMedia": "Personal Task",
    "durationMinutes": 190,
    "startTime": "14:20",
    "endTime": "17:30",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/vmqQStVl5cnObeJQkSnYMXGnA8BTsSit"
  },
  {
    "id": "sched-row-70",
    "rowNumber": 70,
    "week": "Week 7",
    "day": "Friday",
    "date": "09/10/2026",
    "activityCount": 61,
    "pic": "IT Staff",
    "topic": "Device Checking Process\n- Develop the web app for Device Checking process",
    "mainMedia": "Personal Task",
    "durationMinutes": 210,
    "startTime": "09:30",
    "endTime": "14:30",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/BcPHVtj6dOdCpJwG1BhAhR3XUkd76nGp"
  },
  {
    "id": "sched-row-71",
    "rowNumber": 71,
    "week": "Week 7",
    "day": "Friday",
    "date": "09/10/2026",
    "activityCount": 62,
    "pic": "IT Staff",
    "topic": "IT Ticketing Process\n- Develop the web app for IT Ticketing process",
    "mainMedia": "Personal Task",
    "durationMinutes": 210,
    "startTime": "14:30",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/vmqQStVl5cnObeJQkSnYMXGnA8BTsSit"
  },
  {
    "id": "sched-row-72",
    "rowNumber": 72,
    "week": "Week 8",
    "day": "Monday",
    "date": "12/10/2026",
    "activityCount": 63,
    "pic": "Experience Manager",
    "topic": "Business English Training",
    "mainMedia": "Online",
    "durationMinutes": 80,
    "startTime": "10:30",
    "endTime": "11:50",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/pyfMFHiocri8otnRyBvGaWg7h5FYJK-3"
  },
  {
    "id": "sched-row-73",
    "rowNumber": 73,
    "week": "Week 8",
    "day": "Monday",
    "date": "12/10/2026",
    "activityCount": 64,
    "pic": "IT Staff",
    "topic": "AI Tools Comparison\n- Compare the strengths and weaknesses of AI tools currently in use, such as ChatGPT, Claude, and other alternatives\n- Evaluate development capabilities and output quality\n- Identify limitations, common issues, and key differences\n- Identify capabilities of paid plans (ChatGPT Business and Claude Max)",
    "mainMedia": "Personal Task",
    "durationMinutes": 400,
    "startTime": "11:50",
    "endTime": "19:30",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/dmofo0SRDcTQk1BiiZvs4RR0Euxe7smJ"
  },
  {
    "id": "sched-row-74",
    "rowNumber": 74,
    "week": "Week 8",
    "day": "Tuesday",
    "date": "13/10/2026",
    "activityCount": 65,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Review business needs, available data, and dashboard requirements\n- Identify the required information and target users",
    "mainMedia": "Personal Task",
    "durationMinutes": 235,
    "startTime": "11:45",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-75",
    "rowNumber": 75,
    "week": "Week 8",
    "day": "Wednesday",
    "date": "14/10/2026",
    "activityCount": 66,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Create the PoC for the HR Dashboard\n- Collect feedback from the HRD team",
    "mainMedia": "Personal Task",
    "durationMinutes": 380,
    "startTime": "09:40",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-76",
    "rowNumber": 76,
    "week": "Week 8",
    "day": "Thursday",
    "date": "15/10/2026",
    "activityCount": 67,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Review feedback from the HRD team regarding the HR Dashboard PoC\n- Adjust the PoC for the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 240,
    "startTime": "09:00",
    "endTime": "13:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-77",
    "rowNumber": 77,
    "week": "Week 8",
    "day": "Thursday",
    "date": "15/10/2026",
    "activityCount": 68,
    "pic": "IT Staff",
    "topic": "Beanstalk App Project\n- Explore and review the available guides and code repository\n- Prepare a list of questions regarding the Beanstalk app",
    "mainMedia": "Personal Task",
    "durationMinutes": 205,
    "startTime": "14:35",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/Li_dNuTIVYdUT13u4S0w4ub6wV8A784W"
  },
  {
    "id": "sched-row-78",
    "rowNumber": 78,
    "week": "Week 8",
    "day": "Friday",
    "date": "16/10/2026",
    "activityCount": 69,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Define the architecture and technology stack",
    "mainMedia": "Personal Task",
    "durationMinutes": 415,
    "startTime": "08:30",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/aLOXFceet2fsw62UKxfVsFucGy44ezq6"
  },
  {
    "id": "sched-row-79",
    "rowNumber": 79,
    "week": "Week 9",
    "day": "Monday",
    "date": "19/10/2026",
    "activityCount": 70,
    "pic": "Experience Manager",
    "topic": "Business English Training",
    "mainMedia": "Online",
    "durationMinutes": 120,
    "startTime": "10:30",
    "endTime": "12:30",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/UDagugqPpSAIBwkOXB3M8HF8FhRAFUj5"
  },
  {
    "id": "sched-row-80",
    "rowNumber": 80,
    "week": "Week 9",
    "day": "Monday",
    "date": "19/10/2026",
    "activityCount": 71,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Develop the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 240,
    "startTime": "14:00",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-81",
    "rowNumber": 81,
    "week": "Week 9",
    "day": "Tuesday",
    "date": "20/10/2026",
    "activityCount": 72,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Continue developing the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 150,
    "startTime": "11:25",
    "endTime": "14:55",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-82",
    "rowNumber": 82,
    "week": "Week 9",
    "day": "Tuesday",
    "date": "20/10/2026",
    "activityCount": 73,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue testing and improve the existing process based on previous results and user feedback",
    "mainMedia": "Personal Task",
    "durationMinutes": 90,
    "startTime": "14:55",
    "endTime": "16:25",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-83",
    "rowNumber": 83,
    "week": "Week 9",
    "day": "Wednesday",
    "date": "21/10/2026",
    "activityCount": 74,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Review feedback from the HRD team regarding the HR Dashboard PoC\n- Adjust the PoC for the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 110,
    "startTime": "09:00",
    "endTime": "15:20",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-84",
    "rowNumber": 84,
    "week": "Week 9",
    "day": "Wednesday",
    "date": "21/10/2026",
    "activityCount": 75,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue testing and improve the existing process based on previous results and user feedback",
    "mainMedia": "Personal Task",
    "durationMinutes": 80,
    "startTime": "15:20",
    "endTime": "16:40",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-85",
    "rowNumber": 85,
    "week": "Week 9",
    "day": "Wednesday",
    "date": "21/10/2026",
    "activityCount": 76,
    "pic": "IT Staff",
    "topic": "Operations Data Scraping Process\n- Develop a data scraping process for specific links/URLs and integrate it with the spreadsheet",
    "mainMedia": "Personal Task",
    "durationMinutes": 80,
    "startTime": "16:40",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/IxCClKikwwnCP6QZ1FuuxAl5wc-MG7vw"
  },
  {
    "id": "sched-row-86",
    "rowNumber": 86,
    "week": "Week 9",
    "day": "Thursday",
    "date": "22/10/2026",
    "activityCount": 77,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Review feedback from the HRD team regarding the HR Dashboard PoC\n- Adjust the PoC for the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 480,
    "startTime": "09:00",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-87",
    "rowNumber": 87,
    "week": "Week 9",
    "day": "Friday",
    "date": "23/10/2026",
    "activityCount": 78,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Discuss adjustments and new requirements with the HRD team",
    "mainMedia": "Personal Task",
    "durationMinutes": 140,
    "startTime": "13:00",
    "endTime": "15:20",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-88",
    "rowNumber": 88,
    "week": "Week 9",
    "day": "Friday",
    "date": "23/10/2026",
    "activityCount": 79,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue testing and improve the existing process based on previous results and user feedback",
    "mainMedia": "Personal Task",
    "durationMinutes": 150,
    "startTime": "15:20",
    "endTime": "17:50",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-89",
    "rowNumber": 89,
    "week": "Week 9",
    "day": "Friday",
    "date": "23/10/2026",
    "activityCount": 80,
    "pic": "IT Staff",
    "topic": "Operations Data Scraping Process\n- Develop a data scraping process for specific links/URLs and integrate it with the spreadsheet",
    "mainMedia": "Personal Task",
    "durationMinutes": 150,
    "startTime": "17:50",
    "endTime": "20:20",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/IxCClKikwwnCP6QZ1FuuxAl5wc-MG7vw"
  },
  {
    "id": "sched-row-90",
    "rowNumber": 90,
    "week": "Week 10",
    "day": "Monday",
    "date": "26/10/2026",
    "activityCount": 81,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Review feedback from the HRD team regarding the HR Dashboard PoC\n- Adjust the PoC for the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 130,
    "startTime": "09:00",
    "endTime": "12:40",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-91",
    "rowNumber": 91,
    "week": "Week 10",
    "day": "Monday",
    "date": "26/10/2026",
    "activityCount": 82,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue testing and improve the existing process based on previous results and user feedback",
    "mainMedia": "Personal Task",
    "durationMinutes": 130,
    "startTime": "12:40",
    "endTime": "15:50",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-92",
    "rowNumber": 92,
    "week": "Week 10",
    "day": "Monday",
    "date": "26/10/2026",
    "activityCount": 83,
    "pic": "IT Staff",
    "topic": "Operations Data Scraping Process\n- Develop a data scraping process for specific links/URLs and integrate it with the spreadsheet",
    "mainMedia": "Personal Task",
    "durationMinutes": 130,
    "startTime": "15:50",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/IxCClKikwwnCP6QZ1FuuxAl5wc-MG7vw"
  },
  {
    "id": "sched-row-93",
    "rowNumber": 93,
    "week": "Week 10",
    "day": "Tuesday",
    "date": "27/10/2026",
    "activityCount": 84,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Discuss adjustments and new requirements with the HRD team",
    "mainMedia": "Personal Task",
    "durationMinutes": 105,
    "startTime": "11:15",
    "endTime": "13:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-94",
    "rowNumber": 94,
    "week": "Week 10",
    "day": "Tuesday",
    "date": "27/10/2026",
    "activityCount": 85,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue testing and improve the existing process based on previous results and user feedback",
    "mainMedia": "Personal Task",
    "durationMinutes": 100,
    "startTime": "14:30",
    "endTime": "16:10",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-95",
    "rowNumber": 95,
    "week": "Week 10",
    "day": "Tuesday",
    "date": "27/10/2026",
    "activityCount": 86,
    "pic": "IT Staff",
    "topic": "Operations Data Scraping Process\n- Develop a data scraping process for specific links/URLs and integrate it with the spreadsheet",
    "mainMedia": "Personal Task",
    "durationMinutes": 100,
    "startTime": "16:10",
    "endTime": "17:50",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/IxCClKikwwnCP6QZ1FuuxAl5wc-MG7vw"
  },
  {
    "id": "sched-row-96",
    "rowNumber": 96,
    "week": "Week 10",
    "day": "Wednesday",
    "date": "28/10/2026",
    "activityCount": 87,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Continue developing the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 135,
    "startTime": "11:40",
    "endTime": "15:55",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-97",
    "rowNumber": 97,
    "week": "Week 10",
    "day": "Wednesday",
    "date": "28/10/2026",
    "activityCount": 88,
    "pic": "IT Staff",
    "topic": "Operations Email Template Creation Process\n- Continue testing and improve the existing process based on previous results and user feedback",
    "mainMedia": "Personal Task",
    "durationMinutes": 110,
    "startTime": "15:55",
    "endTime": "17:45",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/-teGQK-CMTY3EZxXA_ijFDbN5HnHPeq2"
  },
  {
    "id": "sched-row-98",
    "rowNumber": 98,
    "week": "Week 10",
    "day": "Thursday",
    "date": "29/10/2026",
    "activityCount": 89,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Continue developing the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 390,
    "startTime": "10:30",
    "endTime": "18:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-99",
    "rowNumber": 99,
    "week": "Week 10",
    "day": "Friday",
    "date": "30/10/2026",
    "activityCount": 90,
    "pic": "IT Staff",
    "topic": "HRD Employee Data Dashboard\n- Continue developing the HR Dashboard",
    "mainMedia": "Personal Task",
    "durationMinutes": 210,
    "startTime": "08:30",
    "endTime": "15:00",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/xuDBNqHXAorabduzZEaMW8RyH7V0EKTd"
  },
  {
    "id": "sched-row-100",
    "rowNumber": 100,
    "week": "Week 10",
    "day": "Friday",
    "date": "30/10/2026",
    "activityCount": 91,
    "pic": "IT Staff",
    "topic": "Cybersecurity - Company Security Assessment\n- Review the assessment scope, objectives, GDPR requirements, and relevant security standards\n- Review the existing security checklist and current practices\n- Check security control and measures",
    "mainMedia": "Personal Task",
    "durationMinutes": 210,
    "startTime": "15:00",
    "endTime": "19:30",
    "progress": "Done",
    "materialsLink": "",
    "notes": "https://notes.noahisme.web.id/share/ewhJ0s78SB7EJAdT8e2Ph2yOwpht62Pg"
  },
  {
    "id": "sched-row-102",
    "rowNumber": 102,
    "week": "Month 2 Review",
    "day": "Monday",
    "date": "02/11/2026",
    "pic": "IT & HRD & MD",
    "topic": "Month 2 Performance Review & Feedback and Month 3 Expectations",
    "mainMedia": "Monthly Review",
    "progress": ""
  },
  {
    "id": "sched-row-106",
    "rowNumber": 106,
    "week": "Month 3 Review",
    "day": "Tuesday",
    "date": "01/12/2026",
    "pic": "IT & HRD & MD",
    "topic": "Month 3 Performance Review & Feedback",
    "mainMedia": "Monthly Review",
    "progress": ""
  }
];

export function escapeTsv(val: unknown): string {
  if (val === undefined || val === null) return '';
  const s = String(val);
  if (s.includes('\t') || s.includes('\n') || s.includes('\r') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}


/**
 * Returns 6-column TSV string for Columns G–L of sheet 'Schedule':
 * [Duration (minutes), Start Time, End Time, Progress, Link to Materials/Recording, Notes]
 *
 * NOTE: Google Sheets Column J only accepts: 'Done', 'In Progress', 'On-Hold', 'Reschedule', or '' (blank).
 * Unstarted activities must be serialized as '' to satisfy Google Sheets data validation.
 */
export function clipboardRowForScheduleGtoL(activity: ScheduleActivity): string {
  const duration = activity.durationMinutes !== undefined ? String(activity.durationMinutes) : "";
  const start = activity.startTime || "";
  const end = activity.endTime || "";
  const progress = activity.progress && activity.progress !== "Not Started" ? activity.progress : "";
  const materialsLink = activity.materialsLink || "";
  const notes = activity.notes || "";

  return [duration, start, end, progress, materialsLink, notes].map(escapeTsv).join("\t");
}

/**
 * Alias for clipboardRowForScheduleGtoL to preserve compatibility with existing callers.
 */
export function clipboardRowForScheduleGtoK(activity: ScheduleActivity): string {
  return clipboardRowForScheduleGtoL(activity);
}

/**
 * Returns 12-column TSV string for Columns A–L of sheet 'Schedule':
 * [Day, Date, Activity Count, PIC, Topic, Main Media, Duration, Start Time, End Time, Progress, Link, Notes]
 */
export function clipboardRowForScheduleFull(activity: ScheduleActivity): string {
  const duration = activity.durationMinutes !== undefined ? String(activity.durationMinutes) : "";
  const count = activity.activityCount !== undefined ? String(activity.activityCount) : "";
  const start = activity.startTime || "";
  const end = activity.endTime || "";
  const progress = activity.progress && activity.progress !== "Not Started" ? activity.progress : "";
  const materialsLink = activity.materialsLink || "";
  const notes = activity.notes || "";

  return [
    activity.day,
    activity.date,
    count,
    activity.pic,
    activity.topic,
    activity.mainMedia,
    duration,
    start,
    end,
    progress,
    materialsLink,
    notes,
  ]
    .map(escapeTsv)
    .join("\t");
}

export interface ScheduleSheetRangeChunk {
  range: string;
  startRow: number;
  endRow: number;
  rowCount: number;
  values: string[][];
}

/**
 * Groups schedule activities into contiguous row chunks for efficient
 * batch updating to sheet 'Schedule' (Columns G–L: Duration, Start, End, Progress, Link, Notes).
 * Automatically preserves title/header rows between weeks and milestones.
 */
export function groupScheduleActivitiesIntoChunks(
  activities: readonly ScheduleActivity[]
): ScheduleSheetRangeChunk[] {
  const sorted = [...activities].sort((a, b) => a.rowNumber - b.rowNumber);
  const chunks: Array<{ startRow: number; endRow: number; values: string[][] }> = [];
  let currentChunk: { startRow: number; endRow: number; values: string[][] } | null = null;

  for (const act of sorted) {
    const rawProgress = act.progress && act.progress !== 'Not Started' ? act.progress : '';
    const rowVals = [
      act.durationMinutes !== undefined && act.durationMinutes !== null ? String(act.durationMinutes) : '',
      act.startTime || '',
      act.endTime || '',
      rawProgress,
      act.materialsLink || '',
      act.notes || '',
    ];

    if (!currentChunk || act.rowNumber !== currentChunk.endRow + 1) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        startRow: act.rowNumber,
        endRow: act.rowNumber,
        values: [rowVals],
      };
    } else {
      currentChunk.endRow = act.rowNumber;
      currentChunk.values.push(rowVals);
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  return chunks.map((c) => ({
    range: `'Schedule'!G${c.startRow}:L${c.endRow}`,
    startRow: c.startRow,
    endRow: c.endRow,
    rowCount: c.values.length,
    values: c.values,
  }));
}

/**
 * Generates TSV text for all schedule activities (Columns G–L) for clipboard pasting.
 */
export function clipboardAllScheduleGtoL(activities: readonly ScheduleActivity[]): string {
  const sorted = [...activities].sort((a, b) => a.rowNumber - b.rowNumber);
  return sorted.map((act) => clipboardRowForScheduleGtoL(act)).join('\n');
}

export function calculateDurationFromTimes(start: string, end: string): number | undefined {
  if (!start || !end) return undefined;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return undefined;
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) {
    // If started in late evening (>= 18:00) and ended after midnight (<= 06:00), handle midnight crossover
    if (sh >= 18 && eh <= 6) {
      diff += 24 * 60;
    } else {
      return undefined;
    }
  }
  return diff >= 0 ? diff : undefined;
}

export function readScheduleCustomizations(raw: string | null): Record<string, Partial<ScheduleActivity>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

export function writeScheduleCustomizations(custom: Record<string, Partial<ScheduleActivity>>): string {
  return JSON.stringify(custom);
}

export function scheduleActivityToActivity(item: ScheduleActivity): Activity {
  const isWelcome = item.topic.toLowerCase().includes('welcome') || item.pic === 'CEO' || item.pic === 'Experience';
  const isSetup = item.topic.toLowerCase().includes('setup') || item.topic.toLowerCase().includes('credential') || item.topic.toLowerCase().includes('account');
  const type = isWelcome ? 'welcome' : isSetup ? 'setup' : 'learning';

  const status: ActivityStatus =
    item.progress?.toLowerCase() === 'done'
      ? 'done'
      : item.progress?.toLowerCase() === 'in progress'
      ? 'in-progress'
      : 'not-started';

  return {
    id: item.id,
    name: item.topic,
    type,
    plannedStart: item.startTime || 'TBD',
    plannedEnd: item.endTime || 'TBD',
    status,
    actualStart: item.startTime,
    actualEnd: item.endTime,
    durationMinutes: item.durationMinutes,
    date: item.date,
    day: item.day,
    activityCount: item.activityCount,
    pic: item.pic,
    materialsLink: item.materialsLink,
    notes: item.notes,
  };
}

export function getMergedScheduleActivities(
  customizations: Record<string, Partial<ScheduleActivity>>
): ScheduleActivity[] {
  return OFFICIAL_SCHEDULE_ACTIVITIES.map((act) => {
    const custom = customizations[act.id];
    if (!custom) return act;
    return {
      ...act,
      ...custom,
    };
  });
}

export function getProgressBadge(progress?: string): string {
  const p = progress?.toLowerCase();
  if (p === 'done') return 'bg-mint-50 text-mint-700 border-mint-200';
  if (p === 'in progress') return 'bg-peach-50 text-peach-700 border-peach-200';
  if (p === 'on-hold') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (p === 'reschedule') return 'bg-sky-50 text-sky-700 border-sky-200';
  return 'bg-stone-50 text-stone-600 border-stone-200';
}

export function getPicBadge(pic?: string): string {
  const p = pic?.toLowerCase() || '';
  if (p.includes('it manager')) return 'bg-sky-50 text-sky-700 border-sky-200';
  if (p.includes('hrd')) return 'bg-purple-50 text-purple-700 border-purple-200';
  if (p.includes('ceo')) return 'bg-peach-50 text-peach-700 border-peach-200';
  if (p.includes('experience')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (p.includes('md')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  return 'bg-stone-50 text-stone-700 border-stone-200';
}

/**
 * Compares an activity date (supports DD/MM/YYYY or YYYY-MM-DD or D/M/YYYY) against a target Date.
 */
export function isSameDate(activityDate: string | undefined, targetDate: Date = new Date()): boolean {
  if (!activityDate) return false;
  const text = activityDate.trim();
  if (!text) return false;

  const targetDay = String(targetDate.getDate()).padStart(2, '0');
  const targetMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
  const targetYear = String(targetDate.getFullYear());

  const ddmmyyyy = `${targetDay}/${targetMonth}/${targetYear}`;
  const yyyymmdd = `${targetYear}-${targetMonth}-${targetDay}`;

  if (text === ddmmyyyy || text === yyyymmdd) return true;

  const match = text.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (match) {
    if (match[1].length === 4) {
      // YYYY-MM-DD
      const y = match[1];
      const m = match[2].padStart(2, '0');
      const d = match[3].padStart(2, '0');
      return `${y}-${m}-${d}` === yyyymmdd;
    } else {
      // DD/MM/YYYY
      const d = match[1].padStart(2, '0');
      const m = match[2].padStart(2, '0');
      const y = match[3];
      return `${d}/${m}/${y}` === ddmmyyyy;
    }
  }

  return false;
}

/**
 * Filters a schedule catalog to only activities matching the given target Date.
 */
export function getTodayScheduleActivities(
  activities: readonly ScheduleActivity[],
  targetDate: Date = new Date()
): ScheduleActivity[] {
  return activities.filter((a) => isSameDate(a.date, targetDate));
}

