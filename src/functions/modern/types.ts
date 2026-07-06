export interface CardInfo {
    index: number
    title: string
    points: string
    completed?: boolean
    href?: string
}

export interface MissionInfo {
    index: number
    title: string
    points: string
    totalTasks: number
    completedTasks: number
    href: string
}